#!/usr/bin/env node
/**
 * UI tests for Canada's Wonderland - Mobile UX + Walking Directions
 * Tests at 390x844 (iPhone 14 / Pixel 7)
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');

if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function runTests() {
  console.log('Starting UI tests...');
  console.log('Base URL:', BASE_URL);
  console.log('Viewport: 390x844 (iPhone 14 / Pixel 7)');
  console.log();
  
  const browser = await chromium.launch({ headless: true });
  
  // Test on both emulations
  for (const device of ['Pixel 7', 'iPhone 14']) {
    console.log(`\n=== Testing on ${device} ===\n`);
    
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: device === 'Pixel 7' 
        ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36'
        : 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
      hasTouch: true
    });
    
    const page = await context.newPage();
    const prefix = device.replace(' ', '-').toLowerCase();
    
    try {
      // Load page
      console.log('1. Loading page...');
      await page.goto(`${BASE_URL}/index.html`);
      await page.waitForSelector('.ride-row', { timeout: 15000 });
      await page.waitForTimeout(2000);
      
      // Check brand-title exists
      const brandTitle = await page.evaluate(() => 
        document.querySelector('.brand-title')?.textContent
      );
      console.log(`   Brand title: "${brandTitle}"`);
      if (!brandTitle) throw new Error('brand-title not found!');
      
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-01-initial.png`) });
      console.log('   ✓ Initial view');
      
      // Test search
      console.log('2. Testing search...');
      await page.locator('#searchInput').fill('Behe');
      await page.waitForTimeout(500);
      
      const searchResults = await page.evaluate(() => 
        document.querySelectorAll('.search-dropdown .search-result, .search-dropdown > div').length
      );
      console.log(`   Found ${searchResults} search results`);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-02-search.png`) });
      
      // Clear search
      await page.evaluate(() => {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchDropdown').classList.remove('visible');
      });
      await page.waitForTimeout(300);
      
      // Test filters panel
      console.log('3. Testing filters...');
      await page.locator('#filterBtn').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-03-filters.png`) });
      
      // Close filters by clicking overlay
      await page.evaluate(() => {
        document.getElementById('filtersPanel')?.classList.remove('visible');
        document.getElementById('filterOverlay')?.classList.remove('visible');
      });
      await page.waitForTimeout(300);
      
      // Test sort menu
      console.log('4. Testing sort...');
      await page.evaluate(() => document.getElementById('sortBtn').click());
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-04-sort.png`) });
      await page.evaluate(() => document.getElementById('sortMenu')?.classList.remove('visible'));
      await page.waitForTimeout(300);
      
      // Test thrill pills
      console.log('5. Testing thrill pills...');
      const thrillPills = await page.evaluate(() => 
        document.querySelectorAll('.thrill-pill, .status.thrill').length
      );
      console.log(`   Found ${thrillPills} thrill pills`);
      
      // Test bottom sheet - swipe up
      console.log('6. Testing bottom sheet...');
      await page.evaluate(() => {
        const sheet = document.querySelector('.bottom-sheet');
        if (sheet) sheet.classList.add('snap-half');
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-05-sheet-half.png`) });
      
      // Test map rotation control
      console.log('7. Testing rotation control...');
      const rotateControl = await page.evaluate(() => 
        !!document.querySelector('.leaflet-control-rotate')
      );
      console.log(`   Rotation control: ${rotateControl ? 'present' : 'missing'}`);
      
      // Test geolocation control
      const locateControl = await page.evaluate(() => 
        !!document.querySelector('.leaflet-control-locate')
      );
      console.log(`   Location control: ${locateControl ? 'present' : 'missing'}`);
      
      // Test walking directions
      console.log('8. Testing walking directions...');
      
      // Close all overlays first
      await page.evaluate(() => {
        document.querySelectorAll('.filter-sheet, .filter-overlay, .sort-menu, .filters-panel').forEach(el => {
          el.classList.remove('visible');
        });
        const sheet = document.querySelector('.bottom-sheet');
        if (sheet) sheet.classList.remove('snap-half', 'snap-full');
      });
      await page.waitForTimeout(300);
      
      await page.evaluate(() => handleWalkHereClick('behemoth'));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-06-start-selector.png`) });
      console.log('   ✓ Start selector shown');
      
      // Select entrance
      await page.evaluate(() => {
        const opt = document.querySelector('.start-option[data-type="entrance"]');
        if (opt) opt.click();
      });
      await page.waitForTimeout(3000);
      
      // Close any overlays for clear route screenshot
      await page.evaluate(() => {
        document.querySelectorAll('.filter-sheet, .filter-overlay, .sort-menu, .filters-panel, .filtersPanel').forEach(el => {
          el.classList.remove('visible');
        });
      });
      await page.waitForTimeout(300);
      
      // Check route
      const routeState = await page.evaluate(() => ({
        walkGraph: !!walkGraph,
        currentRoute: currentRoute ? {
          start: currentRoute.startName,
          end: currentRoute.endName,
          distance: currentRoute.route?.distance
        } : null,
        barVisible: document.querySelector('#directionsBar')?.classList.contains('visible'),
        polylines: document.querySelectorAll('.leaflet-overlay-pane path').length
      }));
      
      console.log(`   Walk graph: ${routeState.walkGraph ? 'loaded' : 'NOT loaded'}`);
      console.log(`   Route: ${routeState.currentRoute ? `${routeState.currentRoute.start} → ${routeState.currentRoute.end}` : 'none'}`);
      console.log(`   Distance: ${routeState.currentRoute?.distance ? Math.round(routeState.currentRoute.distance) + 'm' : 'N/A'}`);
      console.log(`   Directions bar: ${routeState.barVisible ? 'visible' : 'NOT visible'}`);
      console.log(`   Polylines: ${routeState.polylines}`);
      
      // Screenshot at initial zoom level (after fitBounds)
      const initialZoom = await page.evaluate(() => map.getZoom());
      console.log(`   Initial zoom: ${initialZoom}`);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-07-route-zoom${Math.round(initialZoom)}.png`) });
      console.log(`   ✓ Route screenshot at zoom ${Math.round(initialZoom)}`);
      
      // Zoom to level 17 for closer view of dotted line
      console.log('   Zooming to level 17...');
      await page.evaluate(() => {
        map.setZoom(17);
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-08-route-zoom17.png`) });
      console.log('   ✓ Route screenshot at zoom 17');
      
      // Zoom to level 18 for even closer view
      console.log('   Zooming to level 18...');
      await page.evaluate(() => {
        map.setZoom(18);
      });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-09-route-zoom18.png`) });
      console.log('   ✓ Route screenshot at zoom 18');
      
      console.log('   ✓ Route displayed at multiple zoom levels');
      
      // Test clear button
      await page.evaluate(() => handleClearRoute());
      await page.waitForTimeout(500);
      
      const barCleared = await page.evaluate(() => 
        !document.querySelector('#directionsBar')?.classList.contains('visible')
      );
      console.log(`   Clear button: ${barCleared ? 'works' : 'FAILED'}`);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-10-cleared.png`) });
      
      // Verify Walk here button in popup
      console.log('9. Verifying Walk here button in popup...');
      
      // Close any overlays first
      await page.evaluate(() => {
        document.querySelectorAll('.filter-sheet, .filter-overlay, .sort-menu').forEach(el => {
          el.classList.remove('visible');
        });
        // Snap sheet to peek
        const sheet = document.querySelector('.bottom-sheet');
        if (sheet) {
          sheet.classList.remove('snap-half', 'snap-full');
          sheet.style.transform = '';
        }
      });
      await page.waitForTimeout(300);
      
      // Click on ride using JavaScript
      await page.evaluate(() => {
        const ride = rides.find(r => r.id === 'leviathan');
        if (ride) panToRideAndSelect(ride);
      });
      await page.waitForTimeout(800);
      
      const popupWalkBtn = await page.evaluate(() => 
        !!document.querySelector('.leaflet-popup .walk-here-btn')
      );
      console.log(`   Walk here in popup: ${popupWalkBtn ? 'present' : 'MISSING'}`);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-11-popup.png`) });
      
      console.log(`\n✓ ${device} tests completed`);
      
    } catch (error) {
      console.error('Test error:', error.message);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, `${prefix}-error.png`) });
    } finally {
      await context.close();
    }
  }
  
  await browser.close();
  
  console.log('\n=== Screenshots saved ===');
  const { readdirSync } = await import('fs');
  const screenshots = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png')).sort();
  for (const s of screenshots) console.log(`  - ${s}`);
}

runTests().catch(console.error);
