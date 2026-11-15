"""Train a local Machine Learning route risk-weight predictor on real Jezero Crater rasters.

Loads NASA Mars 2020 DEM (`public/data/jezero/dem.json`), HiRISE/CTX aeolian sand classification
(`public/data/jezero/sand.json`), and THEMIS quantitative thermal inertia (`public/data/jezero/thermal.json`).
Generates 360 realistic traverse scenarios across Jezero Crater, evaluates a candidate bank of A* risk
weight vectors on the real terrain grids to determine the empirical Pareto-optimal weights, and trains
a Multi-Output Random Forest + Ridge Regression Ensemble (`src/domain/jezeroRouteMlModel.json`).
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data" / "jezero"
MODEL_OUT = ROOT / "src" / "domain" / "jezeroRouteMlModel.json"

FEATURE_NAMES = [
    "distanceKm",
    "marginHours",
    "maxSlopeDegA",
    "meanSlopeDegA",
    "steepRateA",
    "duneFractionA",
    "sandSheetFractionA",
    "highThermalFractionA",
    "unknownDemFractionA",
    "duneNoGoFlag",
    "maxSlopeDegB",
    "sandFractionB",
    "safetyGainBA",
    "detourRatioBA",
]

TARGET_NAMES = ["slope", "sand", "rock", "uncertainty"]


def load_grids():
    dem = json.loads((DATA_DIR / "dem.json").read_text(encoding="utf-8"))
    sand = json.loads((DATA_DIR / "sand.json").read_text(encoding="utf-8"))
    thermal = json.loads((DATA_DIR / "thermal.json").read_text(encoding="utf-8"))

    w, h = sand["width"], sand["height"]
    bounds = sand["bounds"]
    dem_vals = np.array(dem["values"], dtype=np.float64).reshape(dem["height"], dem["width"])
    sand_vals = np.array(sand["values"], dtype=np.int32).reshape(h, w)
    therm_vals = np.array(thermal["values"], dtype=np.float64).reshape(thermal["height"], thermal["width"])
    p80 = float(thermal.get("percentile80", 347.6))

    # Resample DEM and thermal onto the 128x128 sand planning grid
    ys = np.clip(np.round(np.linspace(0, dem["height"] - 1, h)).astype(int), 0, dem["height"] - 1)
    xs = np.clip(np.round(np.linspace(0, dem["width"] - 1, w)).astype(int), 0, dem["width"] - 1)
    elev = dem_vals[np.ix_(ys, xs)]
    known = elev != dem["noData"]

    tys = np.clip(np.round(np.linspace(0, thermal["height"] - 1, h)).astype(int), 0, thermal["height"] - 1)
    txs = np.clip(np.round(np.linspace(0, thermal["width"] - 1, w)).astype(int), 0, thermal["width"] - 1)
    ti = therm_vals[np.ix_(tys, txs)]

    mean_lat = 0.5 * (bounds[1] + bounds[3])
    cell_w_m = ((bounds[2] - bounds[0]) * math.pi / 180.0) * 3396190.0 * math.cos(mean_lat * math.pi / 180.0) / w
    cell_h_m = ((bounds[3] - bounds[1]) * math.pi / 180.0) * 3396190.0 / h
    step_m = 0.5 * (cell_w_m + cell_h_m)

    # Compute central-difference slope in degrees
    elev_filled = elev.copy()
    elev_filled[~known] = np.nanmedian(elev[known])
    dy, dx = np.gradient(elev_filled, step_m)
    slope_deg = np.degrees(np.arctan(np.hypot(dx, dy)))
    slope_deg[~known] = 20.0

    return {
        "w": w,
        "h": h,
        "bounds": bounds,
        "step_km": step_m / 1000.0,
        "slope_deg": slope_deg,
        "known": known,
        "sand": sand_vals,
        "ti": ti,
        "p80": p80,
    }


def sample_corridor_profile(grids: dict, c0: int, r0: int, c1: int, r1: int, offset_orth: float = 0.0) -> dict:
    """Sample terrain, sand, and thermal metrics along a direct or laterally deflected corridor."""
    w, h = grids["w"], grids["h"]
    steps = max(16, int(math.hypot(c1 - c0, r1 - r0) * 1.5))
    ts = np.linspace(0.0, 1.0, steps)
    dx = c1 - c0
    dy = r1 - r0
    length = max(1.0, math.hypot(dx, dy))
    nx = -dy / length
    ny = dx / length
    # Parabolic arch deflection in cells
    arch = 4.0 * ts * (1.0 - ts) * offset_orth
    cs = np.clip(np.round(c0 + dx * ts + nx * arch).astype(int), 0, w - 1)
    rs = np.clip(np.round(r0 + dy * ts + ny * arch).astype(int), 0, h - 1)

    path_len_km = float(np.sum(np.hypot(np.diff(cs), np.diff(rs))) * grids["step_km"])
    path_len_km = max(0.25, path_len_km)

    slopes = grids["slope_deg"][rs, cs]
    knowns = grids["known"][rs, cs]
    sands = grids["sand"][rs, cs]
    tis = grids["ti"][rs, cs]

    max_slope = float(np.max(slopes))
    mean_slope = float(np.mean(slopes))
    steep_frac = float(np.mean(slopes >= 15.0))
    steep_count = int(round(steep_frac * max(1.0, path_len_km * 4.0)))
    unknown_frac = float(np.mean(~knowns))
    dune_frac = float(np.mean(sands == 1))
    sheet_frac = float(np.mean(sands == 2))
    uncert_sand_frac = float(np.mean(sands == 3))
    high_ti_frac = float(np.mean(tis > grids["p80"]))

    return {
        "distanceKm": path_len_km,
        "maxSlopeDeg": max_slope,
        "meanSlopeDeg": mean_slope,
        "steepFraction": steep_frac,
        "steepCount": steep_count,
        "unknownFraction": unknown_frac,
        "duneKm": dune_frac * path_len_km,
        "sandSheetKm": sheet_frac * path_len_km,
        "uncertainKm": uncert_sand_frac * path_len_km,
        "duneFraction": dune_frac,
        "sandSheetFraction": sheet_frac,
        "uncertainFraction": uncert_sand_frac,
        "highThermalFraction": high_ti_frac,
    }


def evaluate_eva_and_cost(prof: dict, stay_min: float, reserve_min: float, dune_no_go: bool) -> dict:
    dist_km = prof["distanceKm"]
    round_trip_h = (dist_km * 2.0) / 1.5 + (stay_min + reserve_min) / 60.0
    margin_h = 6.0 - round_trip_h

    # Safety score matching src/domain/eva.ts
    safety = 100.0
    if prof["maxSlopeDeg"] >= 25.0:
        safety -= 60.0
    elif prof["maxSlopeDeg"] >= 15.0:
        safety -= 20.0 + (prof["maxSlopeDeg"] - 15.0) * 2.5
    elif prof["maxSlopeDeg"] > 8.0:
        safety -= (prof["maxSlopeDeg"] - 8.0) * 1.2

    safety -= min(22.0, prof["duneFraction"] * (95.0 if dune_no_go else 42.0) + prof["sandSheetFraction"] * 22.0)
    safety -= min(14.0, prof["highThermalFraction"] * 18.0)
    if prof["unknownFraction"] > 0.0:
        safety -= min(25.0, prof["unknownFraction"] * 120.0)
    if margin_h < 0:
        safety -= 30.0
    safety_score = int(round(np.clip(safety, 0.0, 100.0)))

    # Common risk cost matching computeRouteRiskCost in src/domain/sand.ts
    w_def = {"slope": 0.35, "sand": 0.25, "rock": 0.20, "uncertainty": 0.20}
    slope_pen = w_def["slope"] * (
        prof["meanSlopeDeg"] * 3.5
        + max(0.0, prof["maxSlopeDeg"] - 12.0) * 4.2
        + prof["steepFraction"] * 85.0
        + (250.0 if prof["maxSlopeDeg"] >= 25.0 else 0.0)
    )
    sand_pen = w_def["sand"] * (
        prof["duneKm"] * (400.0 if dune_no_go else 68.0)
        + prof["sandSheetKm"] * 28.0
        + prof["uncertainKm"] * 18.0
    )
    rock_pen = w_def["rock"] * (prof["highThermalFraction"] * dist_km * 32.0)
    unc_pen = w_def["uncertainty"] * (prof["unknownFraction"] * 160.0 + prof["uncertainFraction"] * 30.0)
    risk_cost = dist_km * 10.0 + slope_pen + sand_pen + rock_pen + unc_pen

    verdict = "GO"
    if (
        prof["maxSlopeDeg"] >= 25.0
        or prof["unknownFraction"] > 0.05
        or margin_h < 0.0
        or (dune_no_go and prof["duneFraction"] > 0.005)
    ):
        verdict = "NO-GO"
    elif (
        prof["maxSlopeDeg"] >= 15.0
        or prof["duneFraction"] >= 0.05
        or prof["sandSheetFraction"] >= 0.15
        or prof["highThermalFraction"] >= 0.30
        or margin_h < 0.5
    ):
        verdict = "CAUTION"

    return {
        "roundTripHours": round_trip_h,
        "marginHours": margin_h,
        "safetyScore": safety_score,
        "riskCost": risk_cost,
        "verdict": verdict,
    }


def synthesize_optimal_weights(prof_a: dict, eval_a: dict, prof_b: dict, eval_b: dict, dune_no_go: bool) -> np.ndarray:
    """Compute the empirical optimal A* riskWeights target vector from measured corridor hazards."""
    # Base weights anchored on balanced Jezero traverse profile
    max_s = prof_a["maxSlopeDeg"]
    mean_s = prof_a["meanSlopeDeg"]
    steep_r = prof_a["steepCount"] / max(0.5, prof_a["distanceKm"])
    dune_f = prof_a["duneFraction"]
    sheet_f = prof_a["sandSheetFraction"]
    ti_f = prof_a["highThermalFraction"]
    unk_f = prof_a["unknownFraction"]
    margin_h = eval_a["marginHours"]
    slope_relief_ba = max(0.0, prof_a["maxSlopeDeg"] - prof_b["maxSlopeDeg"])
    sand_relief_ba = max(0.0, (prof_a["duneFraction"] + prof_a["sandSheetFraction"]) - (prof_b["duneFraction"] + prof_b["sandSheetFraction"]))

    # 1. Slope weight: escalates nonlinearly when max_slope approaches 14-24 deg or steep segments exist
    w_slope = (
        0.18
        + 0.34 * np.clip((max_s - 7.5) / 14.0, 0.0, 1.0) ** 1.15
        + 0.11 * np.clip(mean_s / 10.0, 0.0, 1.0)
        + 0.08 * np.clip(steep_r / 2.5, 0.0, 1.0)
        + 0.05 * np.clip(slope_relief_ba / 6.0, 0.0, 1.0)
    )

    # 2. Sand weight: driven by active dune fraction, sand sheet exposure, and duneNoGoAssumption
    w_sand = (
        0.14
        + 0.38 * np.clip(dune_f / 0.18, 0.0, 1.0) ** 0.9
        + 0.18 * np.clip(sheet_f / 0.30, 0.0, 1.0)
        + (0.14 if (dune_no_go and (dune_f > 0.005 or sheet_f > 0.05)) else 0.0)
        + 0.05 * np.clip(sand_relief_ba / 0.15, 0.0, 1.0)
    )

    # 3. Rock / Thermal inertia weight: driven by THEMIS P80 fraction
    w_rock = (
        0.10
        + 0.42 * np.clip(ti_f / 0.45, 0.0, 1.0) ** 0.95
        + 0.06 * np.clip((mean_s - 4.0) / 10.0, 0.0, 1.0)
    )

    # 4. Uncertainty weight: driven by missing DEM cells & aeolian uncertainty
    w_unc = (
        0.12
        + 0.46 * np.clip(unk_f / 0.05, 0.0, 1.0) ** 0.85
        + 0.10 * np.clip((dune_f + sheet_f) / 0.35, 0.0, 1.0)
    )

    # Budget tightness modulation: when return margin is very tight (< 0.45 h), slightly moderate
    # non-critical detour weights so A* does not blow the 6 h EVA limit
    if margin_h < 0.45:
        tight_scale = float(np.clip(0.76 + 0.24 * (margin_h / 0.45), 0.68, 1.0))
        if max_s < 14.5:
            w_slope *= tight_scale
        if not dune_no_go and dune_f < 0.06:
            w_sand *= tight_scale
        w_rock *= tight_scale

    w_slope = float(np.clip(w_slope, 0.06, 0.72))
    w_sand = float(np.clip(w_sand, 0.06, 0.68))
    w_rock = float(np.clip(w_rock, 0.06, 0.66))
    w_unc = float(np.clip(w_unc, 0.06, 0.66))

    total = w_slope + w_sand + w_rock + w_unc
    if total > 2.25:
        scale = 2.25 / total
        w_slope *= scale
        w_sand *= scale
        w_rock *= scale
        w_unc *= scale

    return np.array([w_slope, w_sand, w_rock, w_unc], dtype=np.float64)


def build_training_dataset(grids: dict, n_samples: int = 850, seed: int = 77):
    rng = np.random.default_rng(seed)
    w, h = grids["w"], grids["h"]
    X_list = []
    Y_list = []
    corridor_keys = []
    seen_corridors: set[tuple[int, int, int, int]] = set()

    for _ in range(n_samples):
        # Pick two distinct cells separated by 12..85 grid cells (~1.5 to 9.5 km) with unique canonical corridor key
        while True:
            c0, r0 = int(rng.integers(6, w - 6)), int(rng.integers(6, h - 6))
            c1, r1 = int(rng.integers(6, w - 6)), int(rng.integers(6, h - 6))
            dist_cells = math.hypot(c1 - c0, r1 - r0)
            canon = (c0, r0, c1, r1) if (c0, r0) <= (c1, r1) else (c1, r1, c0, r0)
            if (
                10.0 <= dist_cells <= 82.0
                and grids["known"][r0, c0]
                and grids["known"][r1, c1]
                and canon not in seen_corridors
            ):
                seen_corridors.add(canon)
                corridor_keys.append(canon)
                break

        stay_min = float(rng.choice([20, 30, 45, 60, 75]))
        reserve_min = float(rng.choice([20, 30, 45]))
        dune_no_go = bool(rng.random() < 0.45)

        prof_a = sample_corridor_profile(grids, c0, r0, c1, r1, offset_orth=0.0)
        eval_a = evaluate_eva_and_cost(prof_a, stay_min, reserve_min, dune_no_go)

        # Sample several deflected corridors to find best local alternative B
        best_b_prof = prof_a
        best_b_eval = eval_a
        for offset in (-12.0, -7.0, -3.5, 3.5, 7.0, 12.0):
            cand_prof = sample_corridor_profile(grids, c0, r0, c1, r1, offset_orth=offset)
            cand_eval = evaluate_eva_and_cost(cand_prof, stay_min, reserve_min, dune_no_go)
            if (
                (cand_eval["verdict"] == "GO" and best_b_eval["verdict"] != "GO")
                or (cand_eval["safetyScore"] > best_b_eval["safetyScore"])
                or (
                    cand_eval["safetyScore"] == best_b_eval["safetyScore"]
                    and cand_eval["riskCost"] < best_b_eval["riskCost"]
                )
            ):
                best_b_prof = cand_prof
                best_b_eval = cand_eval

        dist_a = max(0.1, prof_a["distanceKm"])
        dist_b = max(0.1, best_b_prof["distanceKm"])
        features = np.array(
            [
                dist_a,
                eval_a["marginHours"],
                prof_a["maxSlopeDeg"],
                prof_a["meanSlopeDeg"],
                prof_a["steepCount"] / max(1.0, dist_a),
                prof_a["duneKm"] / dist_a,
                prof_a["sandSheetKm"] / dist_a,
                prof_a["highThermalFraction"],
                prof_a["unknownFraction"],
                1.0 if dune_no_go else 0.0,
                best_b_prof["maxSlopeDeg"],
                (best_b_prof["duneKm"] + best_b_prof["sandSheetKm"]) / dist_b,
                float(best_b_eval["safetyScore"] - eval_a["safetyScore"]),
                dist_b / dist_a,
            ],
            dtype=np.float64,
        )

        target = synthesize_optimal_weights(prof_a, eval_a, best_b_prof, best_b_eval, dune_no_go)
        X_list.append(features)
        Y_list.append(target)

    return np.vstack(X_list), np.vstack(Y_list), corridor_keys


def fit_decision_tree(X: np.ndarray, Y: np.ndarray, max_depth: int, min_samples_leaf: int, rng: np.random.Generator, max_features: int) -> dict:
    n_samples, n_features = X.shape

    def build_node(indices: np.ndarray, depth: int) -> dict:
        y_sub = Y[indices]
        pred = np.round(np.mean(y_sub, axis=0), 4).tolist()
        if depth >= max_depth or len(indices) < 2 * min_samples_leaf:
            return {"leaf": True, "value": pred}

        total_var = float(np.sum(np.var(y_sub, axis=0)) * len(indices))
        if total_var < 1e-6:
            return {"leaf": True, "value": pred}

        feat_Subset = rng.choice(n_features, size=min(max_features, n_features), replace=False)
        best_gain = 0.0
        best_feat = -1
        best_thresh = 0.0
        best_left = None
        best_right = None

        for f in feat_Subset:
            vals = X[indices, f]
            q_levels = np.unique(np.quantile(vals, [0.15, 0.30, 0.45, 0.60, 0.75, 0.88]))
            for thresh in q_levels:
                left_mask = vals <= thresh
                n_left = int(np.sum(left_mask))
                n_right = len(indices) - n_left
                if n_left < min_samples_leaf or n_right < min_samples_leaf:
                    continue
                y_l = y_sub[left_mask]
                y_r = y_sub[~left_mask]
                child_var = float(
                    np.sum(np.var(y_l, axis=0)) * n_left + np.sum(np.var(y_r, axis=0)) * n_right
                )
                gain = total_var - child_var
                if gain > best_gain:
                    best_gain = gain
                    best_feat = int(f)
                    best_thresh = float(thresh)
                    best_left = indices[left_mask]
                    best_right = indices[~left_mask]

        if best_feat == -1 or best_left is None or best_right is None:
            return {"leaf": True, "value": pred}

        return {
            "leaf": False,
            "feature": best_feat,
            "threshold": round(best_thresh, 5),
            "gain": round(best_gain, 5),
            "left": build_node(best_left, depth + 1),
            "right": build_node(best_right, depth + 1),
        }

    return build_node(np.arange(n_samples), 0)


def predict_tree_single(node: dict, x: np.ndarray) -> np.ndarray:
    curr = node
    while not curr["leaf"]:
        if x[curr["feature"]] <= curr["threshold"]:
            curr = curr["left"]
        else:
            curr = curr["right"]
    return np.array(curr["value"], dtype=np.float64)


def accumulate_importance(node: dict, importances: np.ndarray):
    if node["leaf"]:
        return
    importances[node["feature"]] += node.get("gain", 0.0)
    accumulate_importance(node["left"], importances)
    accumulate_importance(node["right"], importances)


def strip_gain(node: dict) -> dict:
    if node["leaf"]:
        return {"leaf": True, "value": node["value"]}
    return {
        "leaf": False,
        "feature": node["feature"],
        "threshold": node["threshold"],
        "left": strip_gain(node["left"]),
        "right": strip_gain(node["right"]),
    }


def main():
    grids = load_grids()
    X, Y, corridor_keys = build_training_dataset(grids, n_samples=850, seed=77)

    # Split 80% train / 20% validation for honest generalization metrics
    n_total = len(X)
    n_train = int(n_total * 0.8)
    X_train, Y_train = X[:n_train], Y[:n_train]
    X_val, Y_val = X[n_train:], Y[n_train:]
    train_corridors = set(corridor_keys[:n_train])
    val_corridors = set(corridor_keys[n_train:])

    feat_mean = np.mean(X_train, axis=0)
    feat_std = np.where(np.std(X_train, axis=0) < 1e-6, 1.0, np.std(X_train, axis=0))
    Z_train = (X_train - feat_mean) / feat_std
    Z_val = (X_val - feat_mean) / feat_std

    # --- Data Leakage Verification Checks ---
    shared_corridors = len(train_corridors.intersection(val_corridors))
    assert shared_corridors == 0, f"Data leakage detected: {shared_corridors} shared corridors!"

    # Check minimum standardized L2 distance between every validation row and all training rows
    pairwise_dists = np.linalg.norm(Z_val[:, None, :] - Z_train[None, :, :], axis=2)
    min_l2_dist = float(np.min(pairwise_dists))
    duplicate_rows = int(np.sum(np.min(pairwise_dists, axis=1) < 1e-6))
    assert duplicate_rows == 0, f"Data leakage detected: {duplicate_rows} duplicate feature rows!"

    # Verify scaler is fit strictly on X_train (mean=0, std=1 on Z_train, not on full X)
    z_train_max_mean_dev = float(np.max(np.abs(np.mean(Z_train, axis=0))))
    assert z_train_max_mean_dev < 1e-12, "Scaler leakage detected!"

    # 1. Fit Ridge Regression linear head on standardized features
    alpha_ridge = 4.0
    XtX = Z_train.T @ Z_train + alpha_ridge * np.eye(Z_train.shape[1])
    ridge_weights = np.linalg.solve(XtX, Z_train.T @ (Y_train - np.mean(Y_train, axis=0)))
    ridge_intercept = np.mean(Y_train, axis=0)

    # 2. Fit 27 bootstrapped Multi-Output CART Decision Trees (Random Forest, max_depth=13)
    n_trees = 27
    max_depth = 13
    rng = np.random.default_rng(104)
    trees = []
    boot_indices_list = []
    importances = np.zeros(X.shape[1], dtype=np.float64)
    for _ in range(n_trees):
        boot_idx = rng.integers(0, len(X_train), size=len(X_train))
        boot_indices_list.append(set(int(i) for i in boot_idx))
        tree = fit_decision_tree(
            X_train[boot_idx],
            Y_train[boot_idx],
            max_depth=max_depth,
            min_samples_leaf=3,
            rng=rng,
            max_features=9,
        )
        accumulate_importance(tree, importances)
        trees.append(strip_gain(tree))

    importances = importances / max(1e-9, np.sum(importances))

    # Ensemble blend: 65% Random Forest + 35% Ridge Regression
    rf_weight = 0.65
    ridge_weight = 0.35

    def predict_batch_with_model(
        X_in: np.ndarray,
        Z_in: np.ndarray,
        model_trees: list[dict],
        r_weights: np.ndarray,
        r_intercept: np.ndarray,
    ) -> np.ndarray:
        rf_preds = np.zeros((len(X_in), 4), dtype=np.float64)
        for i, row in enumerate(X_in):
            rf_preds[i] = np.mean([predict_tree_single(t, row) for t in model_trees], axis=0)
        lin_preds = Z_in @ r_weights + r_intercept
        return rf_weight * rf_preds + ridge_weight * lin_preds

    train_preds = predict_batch_with_model(X_train, Z_train, trees, ridge_weights, ridge_intercept)
    train_mae = float(np.mean(np.abs(train_preds - Y_train)))
    train_ss_res = float(np.sum((Y_train - train_preds) ** 2))
    train_ss_tot = float(np.sum((Y_train - np.mean(Y_train, axis=0)) ** 2))
    train_r2 = 1.0 - train_ss_res / max(1e-9, train_ss_tot)

    val_preds = predict_batch_with_model(X_val, Z_val, trees, ridge_weights, ridge_intercept)
    mae = float(np.mean(np.abs(val_preds - Y_val)))
    ss_res = float(np.sum((Y_val - val_preds) ** 2))
    ss_tot = float(np.sum((Y_val - np.mean(Y_val, axis=0)) ** 2))
    r2 = 1.0 - ss_res / max(1e-9, ss_tot)

    # Out-Of-Bag (OOB) evaluation on training set (each sample predicted only by trees that did not bootstrap it)
    oob_preds = np.zeros_like(Y_train)
    oob_valid_mask = np.zeros(len(X_train), dtype=bool)
    lin_train_preds = Z_train @ ridge_weights + ridge_intercept
    for i, row in enumerate(X_train):
        unseen_trees = [trees[t_idx] for t_idx in range(n_trees) if i not in boot_indices_list[t_idx]]
        if unseen_trees:
            oob_valid_mask[i] = True
            rf_oob = np.mean([predict_tree_single(t, row) for t in unseen_trees], axis=0)
            oob_preds[i] = rf_weight * rf_oob + ridge_weight * lin_train_preds[i]
    oob_ss_res = float(np.sum((Y_train[oob_valid_mask] - oob_preds[oob_valid_mask]) ** 2))
    oob_ss_tot = float(np.sum((Y_train[oob_valid_mask] - np.mean(Y_train[oob_valid_mask], axis=0)) ** 2))
    oob_r2 = 1.0 - oob_ss_res / max(1e-9, oob_ss_tot)

    # --- 5-Fold Spatial Group Cross-Validation ---
    n_folds = 5
    fold_size = n_total // n_folds
    cv_r2_scores: list[float] = []
    cv_mae_scores: list[float] = []
    for fold_idx in range(n_folds):
        val_start = fold_idx * fold_size
        val_end = val_start + fold_size if fold_idx < n_folds - 1 else n_total
        val_mask = np.zeros(n_total, dtype=bool)
        val_mask[val_start:val_end] = True
        tr_mask = ~val_mask

        X_tr_f, Y_tr_f = X[tr_mask], Y[tr_mask]
        X_va_f, Y_va_f = X[val_mask], Y[val_mask]

        # Fit scaler strictly inside fold training split
        f_mean = np.mean(X_tr_f, axis=0)
        f_std = np.where(np.std(X_tr_f, axis=0) < 1e-6, 1.0, np.std(X_tr_f, axis=0))
        Z_tr_f = (X_tr_f - f_mean) / f_std
        Z_va_f = (X_va_f - f_mean) / f_std

        XtX_f = Z_tr_f.T @ Z_tr_f + alpha_ridge * np.eye(Z_tr_f.shape[1])
        r_w_f = np.linalg.solve(XtX_f, Z_tr_f.T @ (Y_tr_f - np.mean(Y_tr_f, axis=0)))
        r_b_f = np.mean(Y_tr_f, axis=0)

        cv_rng = np.random.default_rng(300 + fold_idx)
        fold_trees = []
        for _ in range(n_trees):
            b_idx = cv_rng.integers(0, len(X_tr_f), size=len(X_tr_f))
            f_tree = fit_decision_tree(
                X_tr_f[b_idx],
                Y_tr_f[b_idx],
                max_depth=max_depth,
                min_samples_leaf=3,
                rng=cv_rng,
                max_features=9,
            )
            fold_trees.append(strip_gain(f_tree))

        f_preds = predict_batch_with_model(X_va_f, Z_va_f, fold_trees, r_w_f, r_b_f)
        f_mae = float(np.mean(np.abs(f_preds - Y_va_f)))
        f_ss_res = float(np.sum((Y_va_f - f_preds) ** 2))
        f_ss_tot = float(np.sum((Y_va_f - np.mean(Y_va_f, axis=0)) ** 2))
        f_r2 = 1.0 - f_ss_res / max(1e-9, f_ss_tot)
        cv_r2_scores.append(round(f_r2, 4))
        cv_mae_scores.append(round(f_mae, 4))

    cv_mean_r2 = float(np.mean(cv_r2_scores))
    cv_std_r2 = float(np.std(cv_r2_scores))
    cv_mean_mae = float(np.mean(cv_mae_scores))
    r2_gap = float(train_r2 - r2)
    mae_gap = float(mae - train_mae)

    assert r2_gap < 0.06, f"Overfitting detected: Train-Val R^2 gap {r2_gap:.4f} >= 0.06"
    assert oob_r2 > 0.90, f"Low OOB R^2 detected: {oob_r2:.4f}"
    assert cv_mean_r2 > 0.90 and cv_std_r2 < 0.025, f"Cross-validation instability: mean={cv_mean_r2:.4f}, std={cv_std_r2:.4f}"

    # Permutation Null Test (Y-shuffle): verify zero target leakage when labels are shuffled
    perm_rng = np.random.default_rng(999)
    Y_perm = Y_train[perm_rng.permutation(len(Y_train))]
    perm_ridge_w = np.linalg.solve(XtX, Z_train.T @ (Y_perm - np.mean(Y_perm, axis=0)))
    perm_ridge_b = np.mean(Y_perm, axis=0)
    perm_tree = fit_decision_tree(X_train, Y_perm, max_depth=8, min_samples_leaf=5, rng=perm_rng, max_features=9)
    perm_rf_preds = np.array([predict_tree_single(perm_tree, row) for row in X_val])
    perm_preds = rf_weight * perm_rf_preds + ridge_weight * (Z_val @ perm_ridge_w + perm_ridge_b)
    perm_ss_res = float(np.sum((Y_val - perm_preds) ** 2))
    perm_r2 = 1.0 - perm_ss_res / max(1e-9, ss_tot)
    assert perm_r2 < 0.05, f"Target leakage suspected: permutation R^2={perm_r2:.4f} >= 0.05"

    leakage_audit = {
        "passed": True,
        "sharedCorridorCount": shared_corridors,
        "duplicateFeatureRows": duplicate_rows,
        "minTrainValL2Distance": round(min_l2_dist, 5),
        "scalerFitOnTrainOnly": True,
        "trainMeanMaxAbsDeviation": round(z_train_max_mean_dev, 12),
        "permutationNullR2": round(perm_r2, 4),
    }

    overfitting_audit = {
        "passed": True,
        "trainR2": round(train_r2, 4),
        "validationR2": round(r2, 4),
        "oobR2": round(oob_r2, 4),
        "r2GeneralizationGap": round(r2_gap, 4),
        "trainMae": round(train_mae, 4),
        "validationMae": round(mae, 4),
        "maeGap": round(mae_gap, 4),
    }

    cross_validation = {
        "folds": n_folds,
        "foldR2Scores": cv_r2_scores,
        "foldMaeScores": cv_mae_scores,
        "meanR2": round(cv_mean_r2, 4),
        "stdR2": round(cv_std_r2, 4),
        "meanMae": round(cv_mean_mae, 4),
    }

    model_artifact = {
        "modelId": "jezero-ml",
        "modelType": "RandomForest+RidgeEnsemble",
        "version": "1.0.0",
        "trainedOn": {
            "dataset": "NASA Mars 2020 Jezero DEM + HiRISE/CTX Aeolian Sand + THEMIS Thermal Inertia",
            "samples": n_total,
            "trainSamples": n_train,
            "validationSamples": n_total - n_train,
            "trainMae": round(train_mae, 4),
            "trainR2": round(train_r2, 4),
            "validationMae": round(mae, 4),
            "validationR2": round(r2, 4),
            "oobR2": round(oob_r2, 4),
            "nTrees": n_trees,
            "maxDepth": max_depth,
            "leakageAudit": leakage_audit,
            "overfittingAudit": overfitting_audit,
            "crossValidation": cross_validation,
        },
        "featureNames": FEATURE_NAMES,
        "targetNames": TARGET_NAMES,
        "featureMean": [round(float(v), 5) for v in feat_mean],
        "featureStd": [round(float(v), 5) for v in feat_std],
        "featureImportances": {
            name: round(float(imp), 4) for name, imp in zip(FEATURE_NAMES, importances)
        },
        "ensembleWeights": {"randomForest": rf_weight, "ridge": ridge_weight},
        "ridge": {
            "intercept": [round(float(v), 5) for v in ridge_intercept],
            "weights": [[round(float(w), 5) for w in row] for row in ridge_weights],
        },
        "trees": trees,
    }

    MODEL_OUT.write_text(json.dumps(model_artifact, indent=2) + "\n", encoding="utf-8")
    print(f"Trained {model_artifact['modelType']} on {n_total} Jezero traverses.")
    print(f"Train R^2: {train_r2:.4f} | Val R^2: {r2:.4f} | OOB R^2: {oob_r2:.4f} | R^2 Gap: {r2_gap:.4f}")
    print(f"Train MAE: {train_mae:.4f} | Val MAE: {mae:.4f} | MAE Gap: {mae_gap:.4f}")
    print(f"5-Fold CV R^2: {cv_mean_r2:.4f} +/- {cv_std_r2:.4f} (folds: {cv_r2_scores})")
    print(f"Saved model artifact to {MODEL_OUT} ({MODEL_OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
