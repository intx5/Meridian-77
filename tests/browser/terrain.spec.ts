import { test, expect, type Page } from '@playwright/test'

async function stats(page: Page) {
  return page.locator('canvas').evaluate((el) => JSON.parse(el.dataset.terrainStats || '{}'))
}
async function openTerrain(page: Page) {
  await page.getByRole('button', { name: '3D Terrain View', exact: true }).click()
  await expect.poll(async () => (await stats(page)).tiles, { timeout: 30000 }).toBe(64)
  await expect.poll(async () => (await stats(page)).textures, { timeout: 30000 }).toBeGreaterThanOrEqual(65)
}

test('3D fills the Upper Delta DEM gap with MOLA and labels its source', async ({ page }) => {
  await page.goto('/')
  await openTerrain(page)
  await expect(page.getByText(/MOLA gap fill/)).toBeVisible()
  await page.getByRole('button', { name: 'Top view', exact: true }).click()
  await expect.poll(async () => Math.abs((await stats(page)).camera[2]), { timeout: 12000 }).toBeLessThan(5)

  // Project a point well inside the north-west gap in the north-up overhead view.
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('Missing 3D canvas')
  const lon = 77.3305, lat = 18.5405
  const centerLon = 77.37871624223126, centerLat = 18.4783735010936
  const metresPerDegree = 3396190 * Math.PI / 180
  const x = (lon - centerLon) * metresPerDegree * Math.cos(centerLat * Math.PI / 180)
  const z = (centerLat - lat) * metresPerDegree
  const pixelsPerMetre = box.height / (2 * Math.tan(Math.PI / 8) * (await stats(page)).camera[1])
  await page.mouse.move(box.x + box.width / 2 + x * pixelsPerMetre, box.y + box.height / 2 + z * pixelsPerMetre)
  await expect(page.locator('.terrain-readout')).toContainText('MOLA terrain · visual only')
})
test('lazy assets, common mission state, relief, controls, editing and resource counts', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '3D Terrain View' })).toBeVisible()
  expect(
    await page.evaluate(
      () =>
        performance
          .getEntriesByType('resource')
          .filter((e) => /Terrain3D|geometry.worker|\/terrain\//.test(e.name)).length,
    ),
  ).toBe(0)
  await page.getByRole('button', { name: /Route B · valley approach/ }).click()
  const assessment = page.locator('[aria-label="Assessment and stations"]')
  const original = await assessment.innerText()
  await openTerrain(page)
  const start = await stats(page)
  const initialTransfer = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => /\/terrain\//.test(e.name))
      .reduce((sum, e) => sum + (e as PerformanceResourceTiming).encodedBodySize, 0),
  )
  expect(start.geometryMiB).toBeLessThan(30)
  expect(start.textureMiBEstimate).toBeLessThan(80)
  await page.getByRole('button', { name: '3× relief', exact: true }).click()
  await expect(page.getByText('ENHANCED RELIEF · 3× — visual only')).toBeVisible()
  expect(await assessment.innerText()).toBe(original)
  await page.getByRole('button', { name: 'Top view', exact: true }).click()
  await expect.poll(async () => Math.abs((await stats(page)).camera[2]), { timeout: 12000 }).toBeLessThan(5)
  await page.getByRole('button', { name: 'Place route points', exact: true }).click()
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('Missing canvas')
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await expect(page.getByRole('button', { name: 'Route point 6', exact: true })).toBeVisible()
  // Native drag must change the camera, without adding a seventh route point.
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.6, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Route point 7', exact: true })).toHaveCount(0)
  await page.locator('.terrain-edit').getByRole('button', { name: 'Undo', exact: true }).click()
  // Editing intentionally converts a preset to a custom route; its measurements are unchanged.
  expect((await assessment.innerText()).replace('Custom traverse', 'Route B · valley approach')).toBe(
    original,
  )
  await page.getByRole('switch', { name: 'Toggle Thermal inertia', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Toggle Thermal inertia', exact: true })).toBeChecked()
  for (let cycle = 0; cycle < 2; cycle++) {
    const oldContext = await page.locator('canvas').evaluateHandle((canvas) => canvas.getContext('webgl2'))
    await page.getByRole('button', { name: '2D Map View', exact: true }).click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect.poll(() => oldContext.evaluate((gl) => gl?.isContextLost())).toBe(true)
    await oldContext.dispose()
    await expect(page.getByRole('switch', { name: 'Toggle Thermal inertia', exact: true })).toBeChecked()
    await openTerrain(page)
    expect((await stats(page)).textures).toBe(65)
  }
  await page.getByRole('button', { name: 'Default 3D', exact: true }).click()
  const animation = await page.evaluate(async () => {
    const begin = performance.now()
    let frames = 0
    await new Promise<void>((resolve) => {
      const tick = () => {
        frames++
        if (performance.now() - begin < 2000) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
    const gl = document.querySelector('canvas')!.getContext('webgl2')!
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      animationRafHz: (frames * 1000) / (performance.now() - begin),
      gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
    }
  })
  await page.screenshot({ path: testInfo.outputPath('terrain.png') })
  expect(errors).toEqual([])
  await testInfo.attach('resource-counts', {
    body: JSON.stringify(
      { initial: start, initialTransferBytes: initialTransfer, final: await stats(page), ...animation },
      null,
      2,
    ),
    contentType: 'application/json',
  })
})

test('station models and labels open the shared science card without adding a route point', async ({ page }) => {
  await page.goto('/')
  await openTerrain(page)
  const label = page.getByRole('button', { name: 'Skinner Ridge · delta front · open science card', exact: true })
  await expect.poll(async () => (await stats(page)).stationModels).toBe(4)
  await label.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Skinner Ridge')
  const photo = page.getByRole('dialog').getByRole('img', { name: /Skinner Ridge/ })
  await expect(photo).toHaveAttribute('src', '/data/jezero/pov/skinner-ridge-pia24925.webp')
  await expect(photo).toHaveJSProperty('naturalWidth', 1600)
  const viewer = page.getByRole('dialog').getByRole('region', { name: '360° surface panorama viewer' })
  await expect(viewer).toBeVisible()
  await expect(viewer.getByTestId('panorama-heading-readout')).toContainText('HDG 000° N')
  await viewer.focus()
  await page.keyboard.press('ArrowRight')
  await expect(viewer.getByTestId('panorama-heading-readout')).toContainText('HDG 012° N')
  await expect(page.getByRole('dialog').getByRole('link', { name: 'NASA/JPL-Caltech/ASU/MSSS' })).toHaveAttribute(
    'href', 'https://science.nasa.gov/photojournal/perseverance-workspace-at-skinner-ridge/',
  )
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Top view', exact: true }).click()
  await expect.poll(async () => Math.abs((await stats(page)).camera[2]), { timeout: 12000 }).toBeLessThan(5)
  await page.getByRole('button', { name: 'Place route points', exact: true }).click()
  const labelBox = await label.boundingBox()
  if (!labelBox) throw new Error('Missing station label')
  // The label is placed 20 pixels above the station anchor.
  await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height + 20)
  await expect(page.getByRole('dialog')).toContainText('Skinner Ridge')
  await expect(page.getByRole('button', { name: 'Route point 1', exact: true })).toHaveCount(0)
})

test('camera edge focus converges and demand renderer becomes idle', async ({ page }) => {
  await page.goto('/')
  await page.locator('#route-lon').fill('77.46241025851957')
  await page.locator('#route-lat').fill('18.41230794886602')
  await page.getByRole('button', { name: 'Add coordinate point' }).click()
  await openTerrain(page)
  await page.getByRole('button', { name: '3× relief', exact: true }).click()
  await page.getByRole('button', { name: 'Top view', exact: true }).click()
  await expect.poll(async () => Math.abs((await stats(page)).camera[2]), { timeout: 12000 }).toBeLessThan(5)
  await page.getByRole('button', { name: 'Route point 1', exact: true }).click()
  await expect
    .poll(async () => Math.abs((await stats(page)).camera[1] - 1480.5), { timeout: 15000 })
    .toBeLessThan(2)
  // A stable frame counter proves that focus is no longer fighting its collision floor.
  let previous = -1,
    stable = 0
  await expect
    .poll(
      async () => {
        const current = (await stats(page)).renderedFrames
        stable = current === previous ? stable + 1 : 0
        previous = current
        return stable
      },
      { timeout: 15000, intervals: [1600] },
    )
    .toBeGreaterThanOrEqual(2)
})

test('WebGL unavailable retains usable 2D fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) {
      if (kind.startsWith('webgl')) return null
      return Reflect.apply(original, this, [kind, ...args])
    } as typeof original
  })
  await page.goto('/')
  await page.getByRole('button', { name: '3D Terrain View', exact: true }).click()
  await expect(
    page
      .locator('.terrain-message')
      .filter({ hasText: /3D terrain unavailable|WebGL is unavailable/ })
      .first(),
  ).toBeVisible()
  await page.getByRole('button', { name: '2D Map View', exact: true }).click()
  await expect(page.locator('.leaflet-container')).toBeVisible()
})

test('lost context offers recovery and preserves route', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Route B · valley approach/ }).click()
  await openTerrain(page)
  await page
    .locator('canvas')
    .evaluate((canvas) => canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext())
  await expect(page.getByRole('alert').filter({ hasText: 'WebGL context lost' })).toBeVisible()
  await page.getByRole('button', { name: 'Return to 2D Map View', exact: true }).click()
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await expect(page.locator('header').first()).toContainText('05 pts')
})

test('missing raster tile is explicit and recoverable', async ({ page }) => {
  await page.route('**/terrain/optical-low/0-0.webp', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '3D Terrain View', exact: true }).click()
  await expect(
    page.getByRole('alert').filter({ hasText: 'Terrain optical tile is unavailable' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Return to 2D Map View', exact: true }).click()
  await expect(page.locator('.leaflet-container')).toBeVisible()
})

test('mobile view controls fit without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await openTerrain(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Top view', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Place route points', exact: true })).toBeVisible()
})

test('sand detection overlay, clickable formation card, and local route planner', async ({
  page,
}) => {
  await page.goto('/')
  const sandToggle = page.getByRole('switch', { name: 'Toggle Sand & Dune Detection', exact: true })
  await expect(sandToggle).toBeVisible()
  await expect(sandToggle).not.toBeChecked()

  await sandToggle.click()
  await expect(sandToggle).toBeChecked()

  const sandPolygon = page.locator('.leaflet-sand-polygons-pane path.leaflet-interactive').first()
  await expect(sandPolygon).toBeAttached()
  await sandPolygon.dispatchEvent('click')

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Hybrid C · HiRISE 25 cm')
  await expect(dialog).toContainText('PSP_003798_1985')
  await expect(dialog).toContainText('do not directly measure soil bearing capacity')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  const shortestBtn = page.getByRole('button', { name: /Plan Route A · Shortest path/ })
  await expect(shortestBtn).toBeVisible()
  await expect(page.getByRole('button', { name: /Plan Route B · Risk-aware path/ })).toHaveCount(0)

  await shortestBtn.click()
  await expect(page.locator('[aria-label="Assessment and stations"]')).toContainText('sand & dune exposure')

  const duneSwitch = page.getByRole('switch', { name: 'Treat dense dune fields as NO-GO', exact: true })
  await duneSwitch.click()
  await expect(duneSwitch).toBeChecked()

  await expect(shortestBtn).toBeVisible()
})

test('Local ML Route Planner: honest fallback on error and verified Route C generation', async ({
  page,
}) => {
  let mockSuccess = false
  await page.route('**/api/ml/plan', async (route) => {
    if (!mockSuccess) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          aiVerified: false,
          model: 'jezero-ml',
          cached: false,
          decision: null,
          telemetry: {
            requestCount: 0,
            cacheHits: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            latencyMs: 1,
          },
          error:
            'Local ML service unavailable. Deterministic Route A remains available.',
          errorCode: 'MODEL_ERROR',
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        aiVerified: true,
        model: 'jezero-ml',
        cached: false,
        decision: {
          riskWeights: { slope: 0.4, sand: 0.3, rock: 0.15, uncertainty: 0.15 },
          preferredRouteId: 'route_c',
          recommendedWaypointIds: ['wp-05'],
          reasoning: [
            'Balances slope safety and dune avoidance while preserving EVA return reserve.',
          ],
          warnings: ['Orbital resolution cannot detect sub-25 cm pebbles or crust induration.'],
        },
        telemetry: {
          requestCount: 1,
          cacheHits: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          latencyMs: 2,
        },
      }),
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'AI Route Planner' })).toBeVisible()

  const analyze = page.getByRole('button', { name: /Run AI Analysis/ })
  const routeCBtn = page.getByRole('button', { name: /Plan Route C · AI candidate/ })
  await analyze.click()
  await expect(page.getByRole('status', { name: 'AI status' })).toContainText(
    'AI Not Verified · Local Routes Active',
  )
  await expect(routeCBtn).toHaveCount(0)

  // When server returns a verified ML JSON response, Route C is computed by local A* and rendered in blue
  mockSuccess = true
  await analyze.click()
  await expect(page.getByRole('region', { name: 'AI assessment' })).toContainText(
    'ML Response Validated (ml-local)',
  )
  await expect(routeCBtn).toBeVisible()
  await routeCBtn.click()
  await expect(page.locator('.leaflet-ai-candidate-routes-pane path')).toHaveCount(3)
})
