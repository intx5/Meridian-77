import { test, expect, type Page } from '@playwright/test'

const response = {
  ok: true, aiVerified: true, model: 'jezero-ml', cached: false,
  decision: {
    riskWeights: { slope: 0.4, sand: 0.3, rock: 0.15, uncertainty: 0.15 },
    preferredRouteId: 'route_c', recommendedWaypointIds: [],
    reasoning: ['Test suggestion; final choice requires local verification.'], warnings: [],
  },
  telemetry: { requestCount: 1, cacheHits: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, latencyMs: 2 },
}

async function addPoint(page: Page, lon: string, lat: string) {
  await page.locator('#route-lon').fill(lon)
  await page.locator('#route-lat').fill(lat)
  await page.getByRole('button', { name: 'Add coordinate point' }).click()
}

test('route analysis beats the model proposal on Jezero and explains the measured improvement', async ({ page }) => {
  await page.route('**/api/ml/plan', route => route.fulfill({ json: response }))
  await page.goto('/')
  const request = page.waitForRequest('**/api/ml/plan')
  await page.getByRole('button', { name: 'Run AI Analysis', exact: false }).click()
  const payload = (await request).postDataJSON()
  expect(payload.candidates.map(({ id }: { id: string }) => id)).toEqual(['route_a', 'route_b'])
  const status = page.getByRole('status', { name: 'Route selection', exact: true })
  await expect(status).toContainText('Terrain-aware recommendation selected')
  await expect(status).toContainText('higher safety')
  expect(payload.candidates[1].safetyScore).toBeGreaterThan(payload.candidates[0].safetyScore)
  await expect(status).toContainText(`Safety ${payload.candidates[1].safetyScore}/100`)
  const modelCandidate = page.getByRole('button', { name: /Plan Route C · AI candidate/ })
  const modelSafety = await modelCandidate.getByText('Safety score', { exact: true }).locator('..').innerText()
  expect(payload.candidates[1].safetyScore).toBeGreaterThan(Number(modelSafety.match(/(\d+)\/100/)![1]))
  await expect(page.getByRole('button', { name: /Terrain-aware recommendation/ })).toHaveAttribute('aria-pressed', 'true')
})

test('an unavailable model still yields the best verified local route', async ({ page }) => {
  await page.route('**/api/ml/plan', route => route.fulfill({ status: 500, json: {
    ...response, ok: false, aiVerified: false, decision: null, errorCode: 'MODEL_ERROR', error: 'ML unavailable',
  } }))
  await page.goto('/')
  await addPoint(page, '77.4509', '18.4446')
  await addPoint(page, '77.435', '18.447')
  await page.getByRole('button', { name: 'Run AI Analysis', exact: false }).click()
  await expect(page.getByRole('status', { name: 'Route selection', exact: true })).toContainText('selected: GO')
  await expect(page.getByRole('status', { name: 'Route selection', exact: true })).toContainText('better verdict (GO vs CAUTION)')
  await expect(page.getByRole('status', { name: 'AI status', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Terrain-aware recommendation/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /Plan Route C · AI candidate/ })).toHaveCount(0)
})

test('the selected recommendation shows outbound arrows in both terrain views', async ({ page }) => {
  await page.route('**/api/deepseek/plan', route => route.fulfill({ json: response }))
  await page.goto('/')
  const mapArrows = page.locator('.route-direction-marker .route-direction-arrow')
  await expect(mapArrows).toHaveCount(0)
  await page.getByRole('button', { name: 'Run AI Analysis', exact: false }).click()
  await expect(page.getByRole('status', { name: 'Route selection' })).toContainText('selected:')
  await expect.poll(() => mapArrows.count()).toBeGreaterThan(1)
  // The default traverse runs predominantly west in the north-up 2D view.
  const averageHorizontalHeading = () => mapArrows.evaluateAll((arrows) =>
    arrows.reduce((sum, arrow) => sum + new DOMMatrix(getComputedStyle(arrow).transform).a, 0) / arrows.length,
  )
  expect(await averageHorizontalHeading()).toBeLessThan(-0.5)

  // Hiding candidate overlays leaves the active traverse and its directions visible.
  await page.getByRole('switch', { name: 'Show normal / AI routes on map' }).click()
  await expect(page.locator('.leaflet-ai-candidate-routes-pane path')).toHaveCount(0)
  await expect(mapArrows.first()).toBeVisible()

  await page.getByRole('button', { name: /Plan Route C · AI candidate/ }).click()
  await expect(mapArrows.first()).toBeVisible()
  await page.getByRole('button', { name: '3D Terrain View', exact: true }).click()
  const terrainArrow = page.locator('.terrain-route-directions .route-direction-arrow:visible').first()
  await expect(terrainArrow).toBeVisible({ timeout: 30000 })
  const heading = () => terrainArrow.evaluate((arrow) => {
    const transform = new DOMMatrix(getComputedStyle(arrow).transform)
    return Math.atan2(transform.b, transform.a)
  })
  const before = await heading()
  await page.getByRole('button', { name: 'Top view', exact: true }).click()
  await expect.poll(heading).not.toBeCloseTo(before, 3)
  await page.locator('.terrain-edit').getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(terrainArrow).toHaveCount(0)
})

test('AI selection preserves safety and loaded scores match route previews', async ({ page }) => {
  await page.route('**/api/deepseek/plan', route => route.fulfill({ json: response }))
  await page.goto('/')
  await addPoint(page, '77.4509', '18.4446')
  await addPoint(page, '77.435', '18.447')
  await expect(page.getByRole('button', { name: /Green|Plan Route B/ })).toHaveCount(0)
  await expect(page.locator('.leaflet-ai-candidate-routes-pane path')).toHaveCount(1)
  const assessment = page.locator('section[aria-labelledby="verdict-heading"]')
  const safetyValue = () => assessment.getByText('Safety', { exact: true }).locator('..').locator('.num').innerText().then(Number)
  const before = await safetyValue()
  await page.getByRole('button', { name: 'Run AI Analysis', exact: false }).click()
  const status = page.getByRole('status', { name: 'Route selection', exact: true })
  await expect(status).toContainText(/selected:|retained:/)
  await expect(page.getByRole('button', { name: /Green|Plan Route B/ })).toHaveCount(0)
  await expect(page.locator('.leaflet-ai-candidate-routes-pane path')).toHaveCount(3)
  expect(await safetyValue()).toBeGreaterThanOrEqual(before)
  // A manual candidate load must use exactly the preview's science/safety inputs too.
  const routeC = page.getByRole('button', { name: /Plan Route C · AI candidate/ })
  const previewSafety = Number((await routeC.getByText('Safety score', { exact: true }).locator('..').innerText()).match(/(\d+)\/100/)![1])
  const previewStops = Number((await routeC.getByText('Science stops', { exact: true }).locator('..').innerText()).match(/\d+/)![0])
  await routeC.click()
  expect(await safetyValue()).toBe(previewSafety)
  const stopRow = page.locator('section[aria-labelledby="ledger-heading"] li').filter({ has: page.getByText('science stops', { exact: true }) })
  await expect(stopRow.locator('.meta')).toHaveText(String(previewStops))
  await addPoint(page, '77.43', '18.449')
  await expect(status).toHaveCount(0)
  await expect(routeC).toHaveCount(0)
})

test('the field card and printable brief identify the custom traverse endpoint', async ({ page }) => {
  await page.goto('/')
  await addPoint(page, '77.4509', '18.4446')
  await addPoint(page, '77.435', '18.447')
  const destination = /77\.4350°\s*E.*18\.4470°\s*N/
  const fieldCard = page.locator('section.field-card')
  await expect(fieldCard).toContainText(destination)
  await expect(fieldCard.locator('img')).toHaveCount(0)
  await page.getByRole('button', { name: 'Printable card' }).click()
  await expect(page.getByRole('dialog')).toContainText(destination)
})

test('clicks in the map margin cannot add an out-of-region route point', async ({ page }) => {
  await page.goto('/')
  const map = page.locator('.leaflet-container')
  const optical = map.locator('img[src$="/optical.webp"]')
  await expect(optical).toBeVisible()
  const mapRect = await map.boundingBox()
  const opticalRect = await optical.boundingBox()
  if (!mapRect || !opticalRect) throw new Error('Missing map or optical layer')
  const y = (mapRect.y + opticalRect.y) / 2
  const x = mapRect.x + mapRect.width / 2
  expect(y).toBeGreaterThan(mapRect.y + 5)
  expect(y).toBeLessThan(opticalRect.y - 5)
  await page.mouse.click(x, y)
  await expect(map.getByTitle('Route point 1', { exact: true })).toHaveCount(0)
})

test('the mission brief with no route has no departure or return deadlines', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Mission brief', exact: true }).click()
  const summary = page.getByRole('dialog').locator('section').filter({
    has: page.getByText('Route summary', { exact: true }),
  })
  await expect(summary.getByText('Latest departure', { exact: true }).locator('..')).toHaveText('Latest departure—')
  await expect(summary.getByText('Latest return', { exact: true }).locator('..')).toHaveText('Latest return—')
})

test('duplicating a coordinate cannot issue a return-by plan', async ({ page }) => {
  await page.goto('/')
  await addPoint(page, '77.435', '18.447')
  await addPoint(page, '77.435', '18.447')
  const fieldCard = page.locator('section.field-card')
  await expect(fieldCard.getByText('Latest departure', { exact: true }).locator('..')).toHaveText('Latest departure—')
  await expect(fieldCard.getByText('Latest return', { exact: true }).locator('..')).toHaveText('Latest return—')
})

test('an unreachable search result cannot replace the current traverse', async ({ page }) => {
  await page.route('**/data/jezero/dem.json', route => route.fulfill({ json: {
    bounds: [77.29436321794068, 18.39402047680302, 77.46306926652184, 18.562726525384175],
    width: 4, height: 4, noData: -9999,
    values: Array.from({ length: 16 }, (_, cell) => Math.floor(cell / 4) * 4000),
  } }))
  await page.goto('/')
  await addPoint(page, '77.4509', '18.447')
  await addPoint(page, '77.435', '18.447')
  const candidate = page.getByRole('button', { name: /Plan Route A · Shortest path/ })
  await expect(candidate).toContainText(/Target is unreachable/)
  await expect(candidate).toBeDisabled()
  await expect(page.locator('.leaflet-ai-candidate-routes-pane path')).toHaveCount(0)
})

test('late AI responses cannot overwrite a route edited while waiting', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/ml/plan', async route => {
    await pending
    await route.fulfill({ json: response })
  })
  await page.goto('/')
  await addPoint(page, '77.4509', '18.4446')
  await addPoint(page, '77.435', '18.447')
  const request = page.waitForRequest('**/api/ml/plan')
  await page.getByRole('button', { name: 'Run AI Analysis', exact: false }).click()
  await request
  await addPoint(page, '77.43', '18.449')
  const editedAssessment = await page.locator('section[aria-labelledby="verdict-heading"]').innerText()
  release()
  await expect(page.getByRole('status', { name: 'Route selection', exact: true })).toContainText('Mission changed')
  expect(await page.locator('section[aria-labelledby="verdict-heading"]').innerText()).toBe(editedAssessment)
  await expect(page.getByRole('button', { name: /Plan Route C · AI candidate/ })).toHaveCount(0)
})

test('over-budget candidates are not automatically loaded despite model preference', async ({ page }) => {
  await page.route('**/api/ml/plan', route => route.fulfill({ json: response }))
  await page.goto('/')
  await addPoint(page, '77.4509', '18.4446')
  await addPoint(page, '77.35', '18.47')
  const before = await page.locator('section[aria-labelledby="verdict-heading"]').innerText()
  await page.getByRole('button', { name: 'Run AI Analysis', exact: false }).click()
  await expect(page.getByRole('status', { name: 'Route selection', exact: true })).toContainText('No feasible route')
  expect(await page.locator('section[aria-labelledby="verdict-heading"]').innerText()).toBe(before)
})


test('caution route cards expose their reason without opening another panel', async ({ page }) => {
  await page.goto('/')
  const card = page.getByRole('button', { name: /Route B · valley approach/ })
  await expect(card).toContainText('CAUTION')
  await expect(card.getByText('Why CAUTION?', { exact: true })).toBeVisible()
  await expect(card.locator('li').first()).toBeVisible()
  expect((await card.locator('li').first().innerText()).length).toBeGreaterThan(20)
})
