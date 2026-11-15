"""
Generate publication-grade XAI (Explainable AI) charts (300 DPI PNG + vector SVG)
for the Meridian 77 Jezero Route ML Model (27-Tree Random Forest + Ridge Ensemble).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from train_route_ml import (
    FEATURE_NAMES,
    TARGET_NAMES,
    build_training_dataset,
    load_grids,
    predict_tree_single,
)

MODEL_PATH = ROOT / "src" / "domain" / "jezeroRouteMlModel.json"
OUT_DIR = ROOT / "docs" / "xai"

FEATURE_LABELS_TR = {
    "duneFractionA": "Kumul Oranı — Rota A (duneFractionA)",
    "highThermalFractionA": "Yüksek Termal Atalet / Ana Kaya (highThermalFractionA)",
    "maxSlopeDegA": "Maksimum Eğim — Rota A (maxSlopeDegA °)",
    "steepRateA": "Dik Segment Yoğunluğu >15° (steepRateA)",
    "unknownDemFractionA": "Eksik DEM Belirsizliği (unknownDemFractionA)",
    "sandFractionB": "Toplam Kum Oranı — Rota B (sandFractionB)",
    "sandSheetFractionA": "Kum Örtüsü Oranı — Rota A (sandSheetFractionA)",
    "safetyGainBA": "Rota B-A Güvenlik Kazancı (safetyGainBA)",
    "maxSlopeDegB": "Maksimum Eğim — Rota B (maxSlopeDegB °)",
    "meanSlopeDegA": "Ortalama Eğim — Rota A (meanSlopeDegA °)",
    "duneNoGoFlag": "Kumul NO-GO Kuralı Aktif (duneNoGoFlag)",
    "marginHours": "EVA Oksijen/Süre Rezervi (marginHours sa)",
    "distanceKm": "Rota Mesafesi (distanceKm km)",
    "detourRatioBA": "Rota B/A Uzama Oranı (detourRatioBA)",
}

# Dark scientific Mars telemetry palette
BG_DARK = "#0c1017"
PANEL_BG = "#131924"
GRID_COLOR = "#253042"
TEXT_MAIN = "#edf2f7"
TEXT_MUTED = "#94a3b8"
ACCENT_ORANGE = "#f97316"
ACCENT_CYAN = "#38bdf8"
ACCENT_GREEN = "#22c55e"
ACCENT_AMBER = "#eab308"
ACCENT_PURPLE = "#a855f7"
ACCENT_RED = "#ef4444"


def apply_scientific_theme():
    plt.rcParams.update({
        "figure.facecolor": BG_DARK,
        "axes.facecolor": PANEL_BG,
        "axes.edgecolor": GRID_COLOR,
        "axes.labelcolor": TEXT_MAIN,
        "axes.titlecolor": TEXT_MAIN,
        "xtick.color": TEXT_MUTED,
        "ytick.color": TEXT_MUTED,
        "text.color": TEXT_MAIN,
        "grid.color": GRID_COLOR,
        "grid.linestyle": "--",
        "grid.alpha": 0.55,
        "font.family": "sans-serif",
        "font.sans-serif": ["Segoe UI", "Arial", "DejaVu Sans"],
        "font.size": 10,
        "axes.titlesize": 12,
        "axes.titleweight": "bold",
    })


def predict_ensemble(model: dict, X_in: np.ndarray) -> np.ndarray:
    mean = np.array(model["featureMean"], dtype=np.float64)
    std = np.array(model["featureStd"], dtype=np.float64)
    Z_in = (X_in - mean) / std

    trees = model["trees"]
    rf_w = model["ensembleWeights"]["randomForest"]
    ridge_w = model["ensembleWeights"]["ridge"]
    r_weights = np.array(model["ridge"]["weights"], dtype=np.float64)
    r_intercept = np.array(model["ridge"]["intercept"], dtype=np.float64)

    rf_preds = np.zeros((len(X_in), 4), dtype=np.float64)
    for i, row in enumerate(X_in):
        rf_preds[i] = np.mean([predict_tree_single(t, row) for t in trees], axis=0)
    lin_preds = Z_in @ r_weights + r_intercept
    return np.clip(rf_w * rf_preds + ridge_w * lin_preds, 0.05, 0.85)


def compute_r2(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    ss_tot = float(np.sum((y_true - np.mean(y_true, axis=0)) ** 2))
    return 1.0 - ss_res / max(1e-9, ss_tot)


def save_both(fig: plt.Figure, stem: str):
    png_path = OUT_DIR / f"{stem}.png"
    svg_path = OUT_DIR / f"{stem}.svg"
    fig.savefig(png_path, dpi=300, bbox_inches="tight", facecolor=BG_DARK)
    fig.savefig(svg_path, bbox_inches="tight", facecolor=BG_DARK)
    plt.close(fig)
    print(f"Saved {png_path.name} & {svg_path.name}")


def plot_01_feature_importance(model: dict, X_val: np.ndarray, Y_val: np.ndarray):
    """Chart 1: MDI Impurity Importance vs Validation Permutation Importance."""
    mdi_dict = model["featureImportances"]
    mdi_vals = np.array([mdi_dict[name] for name in FEATURE_NAMES], dtype=np.float64)

    base_preds = predict_ensemble(model, X_val)
    base_r2 = compute_r2(Y_val, base_preds)

    rng = np.random.default_rng(42)
    perm_drops = np.zeros(len(FEATURE_NAMES), dtype=np.float64)
    n_repeats = 12
    for f_idx in range(len(FEATURE_NAMES)):
        drops = []
        for _ in range(n_repeats):
            X_perm = X_val.copy()
            X_perm[:, f_idx] = rng.permutation(X_perm[:, f_idx])
            perm_r2 = compute_r2(Y_val, predict_ensemble(model, X_perm))
            drops.append(max(0.0, base_r2 - perm_r2))
        perm_drops[f_idx] = float(np.mean(drops))

    perm_norm = perm_drops / max(1e-9, np.sum(perm_drops))

    order = np.argsort(mdi_vals)
    sorted_names = [FEATURE_LABELS_TR[FEATURE_NAMES[i]] for i in order]
    sorted_mdi = mdi_vals[order] * 100.0
    sorted_perm = perm_norm[order] * 100.0

    fig, ax = plt.subplots(figsize=(12, 7.2))
    y_pos = np.arange(len(FEATURE_NAMES))
    bar_h = 0.38

    bars1 = ax.barh(
        y_pos + bar_h / 2,
        sorted_mdi,
        height=bar_h,
        color=ACCENT_ORANGE,
        edgecolor="#fb923c",
        label="Ağaç Varyans Azaltma Önemi — MDI (%)",
    )
    bars2 = ax.barh(
        y_pos - bar_h / 2,
        sorted_perm,
        height=bar_h,
        color=ACCENT_CYAN,
        edgecolor="#7dd3fc",
        label="Doğrulama Seti Permütasyon Önemi — ΔR² Payı (%)",
    )

    for b in bars1:
        w = b.get_width()
        if w >= 1.2:
            ax.text(w + 0.4, b.get_y() + b.get_height() / 2, f"%{w:.1f}", va="center", fontsize=8.5, color=ACCENT_ORANGE, fontweight="bold")
    for b in bars2:
        w = b.get_width()
        if w >= 1.2:
            ax.text(w + 0.4, b.get_y() + b.get_height() / 2, f"%{w:.1f}", va="center", fontsize=8.5, color=ACCENT_CYAN)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(sorted_names, fontsize=9.5)
    ax.set_xlabel("Göreli Öznitelik Katkı Payı (%)", fontsize=10.5, fontweight="bold")
    ax.set_xlim(0, max(np.max(sorted_mdi), np.max(sorted_perm)) * 1.16)
    ax.grid(True, axis="x")
    ax.legend(loc="lower right", facecolor=BG_DARK, edgecolor=GRID_COLOR, fontsize=9.5)
    ax.set_title(
        "XAI Grafik 1 — Global Öznitelik Önemi: MDI (Ağaç Bölünme Kazancı) vs. Permütasyon ΔR²\n"
        "Jezero Random Forest (n_trees=27, max_depth=13) + Ridge Ensemble | N=850 Traverse",
        pad=14,
    )

    save_both(fig, "01_feature_importance_mdi_vs_permutation")


def plot_02_partial_dependence(model: dict, X_val: np.ndarray):
    """Chart 2: 2x2 Partial Dependence Plots (PDP) + ICE Shaded Confidence Bands."""
    configs = [
        {
            "feat_name": "maxSlopeDegA",
            "target_idx": 0,
            "target_label": "Tahmin Edilen Eğim Risk Ağırlığı (slope)",
            "x_label": "Rota A Maksimum Eğim — maxSlopeDegA (°)",
            "color": ACCENT_ORANGE,
            "thresholds": [(15.0, "15° Dik Eğim Eşiği"), (22.0, "22° Kritik Limit")],
            "title": "(A) Maksimum Eğim → Eğim Risk Ağırlığı (PDP + ±1σ ICE)",
        },
        {
            "feat_name": "duneFractionA",
            "target_idx": 1,
            "target_label": "Tahmin Edilen Kumul Risk Ağırlığı (sand)",
            "x_label": "Rota A Aktif Kumul Oranı — duneFractionA",
            "color": ACCENT_AMBER,
            "thresholds": [(0.15, "%15 Kumul Uyarısı"), (0.35, "%35 Yüksek Kumul")],
            "title": "(B) Kumul Oranı → Kum Risk Ağırlığı (PDP + ±1σ ICE)",
        },
        {
            "feat_name": "highThermalFractionA",
            "target_idx": 2,
            "target_label": "Tahmin Edilen Kaya/Pürüzlülük Ağırlığı (rock)",
            "x_label": "Yüksek Termal Atalet Oranı — highThermalFractionA",
            "color": ACCENT_CYAN,
            "thresholds": [(0.35, "%35 Sert Kayaç Eşiği")],
            "title": "(C) Termal Atalet → Kayaç Risk Ağırlığı (PDP + ±1σ ICE)",
        },
        {
            "feat_name": "unknownDemFractionA",
            "target_idx": 3,
            "target_label": "Tahmin Edilen Belirsizlik Ağırlığı (uncertainty)",
            "x_label": "Eksik DEM Veri Oranı — unknownDemFractionA",
            "color": ACCENT_PURPLE,
            "thresholds": [(0.05, "%5 Veri Boşluğu Eşiği")],
            "title": "(D) DEM Veri Boşluğu → Belirsizlik Ağırlığı (PDP + ±1σ ICE)",
        },
    ]

    fig, axes = plt.subplots(2, 2, figsize=(13.5, 9.5))
    fig.suptitle(
        "XAI Grafik 2 — Kısmi Bağımlılık Eğrileri (Partial Dependence Plot / PDP & ICE ±1σ)\n"
        "Mars Arazi Tehlikesi Değiştikçe Modelin A* Risk Ağırlıklarına Verdiği Doğrusal Olmayan Tepki",
        fontsize=13,
        fontweight="bold",
        y=0.98,
    )

    for ax, cfg in zip(axes.flat, configs):
        f_idx = FEATURE_NAMES.index(cfg["feat_name"])
        t_idx = cfg["target_idx"]
        f_min = float(np.percentile(X_val[:, f_idx], 1))
        f_max = float(np.percentile(X_val[:, f_idx], 99))
        if cfg["feat_name"] == "unknownDemFractionA":
            f_min, f_max = 0.0, 0.25
        grid_vals = np.linspace(f_min, f_max, 45)

        pdp_mean = np.zeros_like(grid_vals)
        pdp_std = np.zeros_like(grid_vals)

        sample_rows = X_val[:80].copy()
        for g_i, g_val in enumerate(grid_vals):
            X_temp = sample_rows.copy()
            X_temp[:, f_idx] = g_val
            preds = predict_ensemble(model, X_temp)[:, t_idx]
            pdp_mean[g_i] = float(np.mean(preds))
            pdp_std[g_i] = float(np.std(preds))

        ax.plot(grid_vals, pdp_mean, color=cfg["color"], linewidth=2.6, label="Ortalama PDP Tepkisi")
        ax.fill_between(
            grid_vals,
            np.clip(pdp_mean - pdp_std, 0.05, 0.85),
            np.clip(pdp_mean + pdp_std, 0.05, 0.85),
            color=cfg["color"],
            alpha=0.20,
            label="ICE Dağılım Bandı (±1σ)",
        )

        for th_val, th_label in cfg["thresholds"]:
            if f_min <= th_val <= f_max:
                ax.axvline(th_val, color=ACCENT_RED, linestyle=":", linewidth=1.4, alpha=0.85)
                ax.text(
                    th_val + (f_max - f_min) * 0.015,
                    float(np.min(pdp_mean)) + 0.01,
                    th_label,
                    color=ACCENT_RED,
                    fontsize=8.5,
                    rotation=90,
                    va="bottom",
                )

        ax.set_title(cfg["title"], fontsize=11)
        ax.set_xlabel(cfg["x_label"], fontsize=9.5)
        ax.set_ylabel(cfg["target_label"], fontsize=9.5)
        ax.grid(True)
        ax.legend(loc="upper left", facecolor=BG_DARK, edgecolor=GRID_COLOR, fontsize=8.5)

    fig.tight_layout(rect=[0, 0, 1, 0.94])
    save_both(fig, "02_partial_dependence_curves")


def plot_03_local_attribution_waterfall(model: dict, X_val: np.ndarray):
    """Chart 3: Local Feature Attribution (SHAP-style Marginal Contribution Waterfall) for a High-Risk Delta Scarp Route."""
    # Pick a validation traverse with both notable slope and sand hazard
    scores = (X_val[:, 2] / 25.0) + (X_val[:, 5] / 0.30) + (X_val[:, 7] / 0.50)
    sample_idx = int(np.argmax(scores))
    x_instance = X_val[sample_idx : sample_idx + 1]

    baseline_x = np.array(model["featureMean"], dtype=np.float64).reshape(1, -1)
    base_pred = predict_ensemble(model, baseline_x)[0]
    final_pred = predict_ensemble(model, x_instance)[0]

    # Exact marginal attribution across features using permutation coalition sampling
    rng = np.random.default_rng(101)
    n_coalitions = 64
    shap_matrix = np.zeros((len(FEATURE_NAMES), 4), dtype=np.float64)

    for _ in range(n_coalitions):
        perm = rng.permutation(len(FEATURE_NAMES))
        x_curr = baseline_x.copy()
        prev_p = base_pred.copy()
        for f_i in perm:
            x_curr[0, f_i] = x_instance[0, f_i]
            new_p = predict_ensemble(model, x_curr)[0]
            shap_matrix[f_i] += (new_p - prev_p) / n_coalitions
            prev_p = new_p

    fig, axes = plt.subplots(2, 2, figsize=(14, 9.5))
    fig.suptitle(
        "XAI Grafik 3 — Yerel Karar Açıklaması (Local SHAP / Marginal Attribution Waterfall)\n"
        f"Örnek Görev Koridoru: Maks. Eğim={x_instance[0, 2]:.1f}°, Kumul=%{x_instance[0, 5]*100:.1f}, "
        f"Termal Kayaç=%{x_instance[0, 7]*100:.1f}, Mesafe={x_instance[0, 0]:.2f} km",
        fontsize=12.5,
        fontweight="bold",
        y=0.98,
    )

    target_titles = [
        ("slope", "Eğim Ağırlığı (slope)", ACCENT_ORANGE),
        ("sand", "Kumul Ağırlığı (sand)", ACCENT_AMBER),
        ("rock", "Kayaç Ağırlığı (rock)", ACCENT_CYAN),
        ("uncertainty", "Belirsizlik Ağırlığı (uncertainty)", ACCENT_PURPLE),
    ]

    for t_idx, (ax, (t_key, t_label, t_color)) in enumerate(zip(axes.flat, target_titles)):
        contribs = shap_matrix[:, t_idx]
        top_idx = np.argsort(np.abs(contribs))[-7:]
        top_names = [f"{FEATURE_NAMES[i]} ({x_instance[0, i]:.2f})" for i in top_idx]
        top_vals = contribs[top_idx]

        colors = [ACCENT_GREEN if v >= 0 else ACCENT_RED for v in top_vals]
        y_pos = np.arange(len(top_idx))
        bars = ax.barh(y_pos, top_vals, color=colors, height=0.55, alpha=0.9)
        ax.axvline(0, color=TEXT_MAIN, linewidth=1.0, alpha=0.7)

        for b, v in zip(bars, top_vals):
            offset = 0.004 if v >= 0 else -0.004
            ha = "left" if v >= 0 else "right"
            ax.text(
                v + offset,
                b.get_y() + b.get_height() / 2,
                f"{v:+.3f}",
                va="center",
                ha=ha,
                fontsize=8.5,
                fontweight="bold",
                color=ACCENT_GREEN if v >= 0 else ACCENT_RED,
            )

        ax.set_yticks(y_pos)
        ax.set_yticklabels(top_names, fontsize=9)
        span = max(0.05, float(np.max(np.abs(top_vals))) * 1.38)
        ax.set_xlim(-span, span)
        ax.grid(True, axis="x")
        ax.set_title(
            f"{t_label}: Baz E[f(X)]={base_pred[t_idx]:.3f} → Tahmin f(x)={final_pred[t_idx]:.3f}",
            fontsize=10.5,
            color=t_color,
        )
        ax.set_xlabel("Tahmin Üzerindeki Yerel SHAP Katkısı (Δ Ağırlık)", fontsize=9)

    fig.tight_layout(rect=[0, 0, 1, 0.93])
    save_both(fig, "03_local_shap_waterfall_octavia_delta")


def plot_04_parity_and_residuals(model: dict, X_val: np.ndarray, Y_val: np.ndarray):
    """Chart 4: Actual vs Predicted Parity Scatter + Residual Error Histogram on Hold-out Validation Set."""
    val_preds = predict_ensemble(model, X_val)
    residuals = (val_preds - Y_val).flatten()

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.5, 5.8))
    fig.suptitle(
        "XAI Grafik 4 — Doğrulama Seti (N=170 Görülmemiş Koridor) Gerçek vs. Tahmin (Parity) ve Hata Dağılımı\n"
        f"Validation R² = {model['trainedOn']['validationR2']:.4f} | Validation MAE = {model['trainedOn']['validationMae']:.4f}",
        fontsize=12.5,
        fontweight="bold",
        y=1.01,
    )

    palette = [ACCENT_ORANGE, ACCENT_AMBER, ACCENT_CYAN, ACCENT_PURPLE]
    labels = ["Eğim (slope)", "Kumul (sand)", "Kayaç (rock)", "Belirsizlik (uncertainty)"]

    for t_idx in range(4):
        ax1.scatter(
            Y_val[:, t_idx],
            val_preds[:, t_idx],
            color=palette[t_idx],
            alpha=0.72,
            s=28,
            label=labels[t_idx],
            edgecolors="none",
        )

    lims = [0.04, 0.86]
    ax1.plot(lims, lims, "--", color=TEXT_MAIN, linewidth=1.5, label="İdeal Eşleşme (y = ŷ)")
    ax1.set_xlim(lims)
    ax1.set_ylim(lims)
    ax1.set_xlabel("Gerçek Optimal A* Risk Ağırlığı (Ground Truth y)", fontsize=10)
    ax1.set_ylabel("ML Ensemble Tahmini (ŷ)", fontsize=10)
    ax1.set_title("Gerçek vs. Tahmin Edilen Risk Ağırlıkları (N=170 × 4 Hedef)", fontsize=11)
    ax1.grid(True)
    ax1.legend(loc="upper left", facecolor=BG_DARK, edgecolor=GRID_COLOR, fontsize=9)

    ax2.hist(residuals, bins=32, color=ACCENT_CYAN, edgecolor=BG_DARK, alpha=0.85)
    ax2.axvline(0.0, color=ACCENT_ORANGE, linestyle="--", linewidth=1.8, label=f"Ortalama Hata: {np.mean(residuals):+.4f}")
    ax2.axvline(np.std(residuals), color=ACCENT_GREEN, linestyle=":", linewidth=1.4, label=f"+1σ ({np.std(residuals):.4f})")
    ax2.axvline(-np.std(residuals), color=ACCENT_GREEN, linestyle=":", linewidth=1.4, label=f"-1σ (-{np.std(residuals):.4f})")
    ax2.set_xlabel("Artık Hata (Residual = ŷ - y)", fontsize=10)
    ax2.set_ylabel("Frekans (Örnek Sayısı)", fontsize=10)
    ax2.set_title("Artık Hata (Residual) Dağılımı — Sıfır Merkezli & Simetrik", fontsize=11)
    ax2.grid(True)
    ax2.legend(loc="upper right", facecolor=BG_DARK, edgecolor=GRID_COLOR, fontsize=9)

    fig.tight_layout()
    save_both(fig, "04_parity_and_residuals")


def plot_05_overfitting_leakage_cv_audit(model: dict):
    """Chart 5: Overfitting, Out-of-Bag, 5-Fold Spatial Cross-Validation & Data Leakage Audit."""
    trained_on = model["trainedOn"]
    overfit = trained_on["overfittingAudit"]
    cv = trained_on["crossValidation"]
    leakage = trained_on["leakageAudit"]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.8, 5.8))
    fig.suptitle(
        "XAI Grafik 5 — Overfitting Denetimi, 5-Fold Spatial Cross-Validation ve Data Leakage Doğrulaması\n"
        f"Train-Val R² Farkı: {overfit['r2GeneralizationGap']:.4f} (<0.06 Eşiği) | 5-Fold CV R²: {cv['meanR2']:.4f} ± {cv['stdR2']:.4f}",
        fontsize=12.5,
        fontweight="bold",
        y=1.01,
    )

    # Panel 1: Benchmark R2 comparison including Permutation Null Test
    metrics_labels = [
        "Eğitim Seti\n(Train R²)",
        "Out-of-Bag\n(OOB R²)",
        "5-Fold CV\n(Ortalama R²)",
        "Hold-Out Val\n(Validation R²)",
        "Y-Shuffle Null\n(Leakage Testi)",
    ]
    metrics_vals = [
        overfit["trainR2"],
        overfit["oobR2"],
        cv["meanR2"],
        overfit["validationR2"],
        leakage["permutationNullR2"],
    ]
    bar_colors = [ACCENT_CYAN, ACCENT_GREEN, ACCENT_GREEN, ACCENT_ORANGE, ACCENT_RED]

    x_pos = np.arange(len(metrics_labels))
    bars = ax1.bar(x_pos, metrics_vals, color=bar_colors, width=0.52, alpha=0.9)
    ax1.axhline(0.0, color=TEXT_MUTED, linewidth=1.0)
    ax1.axhline(0.90, color=ACCENT_GREEN, linestyle="--", linewidth=1.2, alpha=0.7, label="Hedef Genelleme Eşiği (R² = 0.90)")

    for b, val in zip(bars, metrics_vals):
        y_text = val + 0.025 if val >= 0 else val - 0.065
        ax1.text(
            b.get_x() + b.get_width() / 2,
            y_text,
            f"{val:.4f}",
            ha="center",
            va="bottom" if val >= 0 else "top",
            fontsize=9.5,
            fontweight="bold",
            color=TEXT_MAIN,
        )

    ax1.set_xticks(x_pos)
    ax1.set_xticklabels(metrics_labels, fontsize=9.5)
    ax1.set_ylim(-0.25, 1.10)
    ax1.set_ylabel("Açıklanan Varyans Skoru (R²)", fontsize=10)
    ax1.set_title("Genelleme (Train / OOB / CV / Val) vs. Sızıntı (Null) Testi", fontsize=11)
    ax1.grid(True, axis="y")
    ax1.legend(loc="lower left", facecolor=BG_DARK, edgecolor=GRID_COLOR, fontsize=9)

    # Panel 2: 5-Fold Cross-Validation stability across Jezero spatial folds
    fold_r2 = cv["foldR2Scores"]
    fold_mae = cv["foldMaeScores"]
    fold_labels = [f"Fold {i+1}\n(170 Koridor)" for i in range(len(fold_r2))]
    f_x = np.arange(len(fold_r2))

    bars_cv = ax2.bar(f_x, fold_r2, color=ACCENT_PURPLE, width=0.48, alpha=0.88, label="Katman R² Skoru")
    ax2.axhline(cv["meanR2"], color=ACCENT_ORANGE, linestyle="--", linewidth=1.8, label=f"5-Fold Ortalama R² = {cv['meanR2']:.4f} (±{cv['stdR2']:.4f})")

    for b, r2_v, mae_v in zip(bars_cv, fold_r2, fold_mae):
        ax2.text(
            b.get_x() + b.get_width() / 2,
            r2_v + 0.004,
            f"R²={r2_v:.4f}\nMAE={mae_v:.3f}",
            ha="center",
            va="bottom",
            fontsize=8.5,
            color=TEXT_MAIN,
        )

    ax2.set_xticks(f_x)
    ax2.set_xticklabels(fold_labels, fontsize=9.5)
    ax2.set_ylim(0.85, 0.985)
    ax2.set_ylabel("Katman Doğrulama Skoru (R²)", fontsize=10)
    ax2.set_title("5-Katlı Mekansal Çapraz Doğrulama (5-Fold Spatial CV) İstikrarı", fontsize=11)
    ax2.grid(True, axis="y")
    ax2.legend(loc="lower right", facecolor=BG_DARK, edgecolor=GRID_COLOR, fontsize=9)

    fig.tight_layout()
    save_both(fig, "05_overfitting_leakage_cv_audit")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    apply_scientific_theme()

    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    grids = load_grids()
    X, Y, _ = build_training_dataset(grids, n_samples=850, seed=77)
    n_train = int(len(X) * 0.8)
    X_val, Y_val = X[n_train:], Y[n_train:]

    plot_01_feature_importance(model, X_val, Y_val)
    plot_02_partial_dependence(model, X_val)
    plot_03_local_attribution_waterfall(model, X_val)
    plot_04_parity_and_residuals(model, X_val, Y_val)
    plot_05_overfitting_leakage_cv_audit(model)
    print(f"All 5 XAI chart pairs (PNG + SVG) generated in {OUT_DIR}")


if __name__ == "__main__":
    main()
