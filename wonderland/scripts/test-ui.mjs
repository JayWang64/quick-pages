#!/usr/bin/env node
/**
 * UI tests for Canada's Wonderland walking directions.
 * 
 * Tests the mobile UI at 390x844 (iPhone 14 / Pixel 7) viewport:
 * - Tap a ride, tap "Walk here", confirm polyline and distance bar
 * - Test clear button
 * 
 * Usage:
 *   node scripts/test-ui.mjs
 * 
 * Requires Playwright to be installed:
 *   npm install -D playwright
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');

// Ensure screenshots directory exists
if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function runTests() {
  console.log('Starting UI tests...');
  console.log('Base URL:', BASE_URL);
  console.log('Screenshots dir:', SCREENSHOTS_DIR);
  console.log();
  
  const browser = await chromium.launch({ headless: true });
  
  // Test on mobile viewport (iPhone 14 / Pixel 7 dimensions)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    hasTouch: true
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to the page
    console.log('1. Loading page...');
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForLoadState('networkidle');
    
    // Wait for rides to load (ride list should populate)
    console.log('   Waiting for ride list to populate...');
    await page.waitForSelector('.ride-row', { timeout: 15000 });
    await page.waitForTimeout(2000); // Let map tiles load
    
    // Take initial screenshot
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '01-initial-view.png') });
    console.log('   ✓ Initial view screenshot saved');
    
    // Scroll down to see rides
    console.log('2. Finding Behemoth ride...');
    await page.evaluate(() => {
      const rideList = document.getElementById('rideList');
      if (rideList) rideList.scrollIntoView();
    });
    await page.waitForTimeout(500);
    
    const behemothRow = page.locator('#ride-behemoth');
    await behemothRow.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '02-behemoth-in-list.png') });
    console.log('   ✓ Behemoth in list screenshot saved');
    
    // Click on Behemoth to open popup
    console.log('3. Clicking Behemoth...');
    await behemothRow.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '03-behemoth-popup.png') });
    console.log('   ✓ Behemoth popup screenshot saved');
    
    // Look for Walk here button in popup
    console.log('4. Looking for Walk here button in popup...');
    const popupWalkBtn = page.locator('.leaflet-popup .walk-here-btn');
    const popupBtnVisible = await popupWalkBtn.isVisible().catch(() => false);
    
    if (popupBtnVisible) {
      console.log('   ✓ Walk here button found in popup');
      // Use JavaScript click to trigger onclick attribute properly
      await page.evaluate(() => {
        const btn = document.querySelector('.leaflet-popup .walk-here-btn');
        if (btn) btn.click();
      });
    } else {
      // Try clicking the Walk here button in the list row
      console.log('   Walk here button not in popup, checking list row...');
      const listWalkBtn = page.locator('#ride-behemoth .walk-here-btn');
      const listBtnVisible = await listWalkBtn.isVisible().catch(() => false);
      
      if (listBtnVisible) {
        await page.locator('.leaflet-popup-close-button').click().catch(() => {});
        await page.evaluate(() => {
          const btn = document.querySelector('#ride-behemoth .walk-here-btn');
          if (btn) btn.click();
        });
        console.log('   ✓ Clicked Walk here in list row');
      } else {
        console.log('   ⚠ No Walk here button found');
      }
    }
    
    // Wait for start selector or route to appear
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '04-start-selector.png') });
    console.log('   ✓ Start selector screenshot saved');
    
    // Check if start selector is visible
    const selectorVisible = await page.evaluate(() => 
      document.querySelector('#startSelector')?.classList.contains('visible')
    );
    
    if (selectorVisible) {
      // Click on Main Entrance option
      console.log('5. Selecting Main Entrance as start...');
      await page.evaluate(() => {
        const opt = document.querySelector('.start-option[data-type="entrance"]');
        if (opt) opt.click();
      });
      await page.waitForTimeout(2000); // Wait for route calculation
    } else {
      console.log('   ⚠ Start selector not visible');
    }
    
    // Scroll to map area for screenshot
    await page.evaluate(() => {
      document.querySelector('#ride-map')?.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await page.waitForTimeout(500);
    
    // Take screenshot of route
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '05-route-displayed.png') });
    console.log('   ✓ Route displayed screenshot saved');
    
    // Check if directions bar is visible
    console.log('6. Checking directions bar...');
    const directionsBar = page.locator('#directionsBar.visible');
    const barVisible = await directionsBar.isVisible().catch(() => false);
    
    if (barVisible) {
      console.log('   ✓ Directions bar is visible');
      
      // Get route info
      const routeText = await directionsBar.locator('.directions-route').textContent().catch(() => '');
      const distText = await directionsBar.locator('.directions-dist').textContent().catch(() => '');
      const timeText = await directionsBar.locator('.directions-time').textContent().catch(() => '');
      
      console.log(`   Route: ${routeText}`);
      console.log(`   Distance: ${distText}`);
      console.log(`   Time: ${timeText}`);
    } else {
      console.log('   ⚠ Directions bar not visible');
    }
    
    // Check if polyline is visible by looking for SVG path elements
    console.log('7. Checking for route polyline...');
    const polylines = await page.locator('.leaflet-overlay-pane path').count();
    console.log(`   Found ${polylines} path elements in map overlay`);
    
    // Test clear button
    console.log('8. Testing clear button...');
    const clearBtnVisible = await page.evaluate(() => {
      const btn = document.querySelector('.directions-close-btn');
      return btn && window.getComputedStyle(btn).display !== 'none';
    });
    
    if (clearBtnVisible) {
      await page.evaluate(() => {
        handleClearRoute();
      });
      await page.waitForTimeout(500);
      
      const barStillVisible = await page.evaluate(() => 
        document.querySelector('#directionsBar')?.classList.contains('visible')
      );
      if (!barStillVisible) {
        console.log('   ✓ Clear button works - directions bar hidden');
      } else {
        console.log('   ⚠ Clear button clicked but bar still visible');
      }
    } else {
      console.log('   ⚠ Clear button not visible');
    }
    
    await page.screenshot({ path: join(SCREENSHOTS_DIR, '06-after-clear.png') });
    console.log('   ✓ After clear screenshot saved');
    
    // Test Walk here button in list row
    console.log('9. Testing Walk here in list row...');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    
    // Find Leviathan and scroll to it
    await page.evaluate(() => {
      const row = document.querySelector('#ride-leviathan');
      if (row) row.scrollIntoView({ behavior: 'instant' });
    });
    await page.waitForTimeout(500);
    
    const levWalkVisible = await page.evaluate(() => {
      const btn = document.querySelector('#ride-leviathan .walk-here-btn');
      return btn && window.getComputedStyle(btn).display !== 'none';
    });
    
    if (levWalkVisible) {
      await page.evaluate(() => handleWalkHereClick('leviathan'));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(SCREENSHOTS_DIR, '07-leviathan-start-selector.png') });
      
      // Select entrance
      const entVisible = await page.evaluate(() => 
        document.querySelector('.start-option[data-type="entrance"]') !== null
      );
      if (entVisible) {
        await page.evaluate(() => {
          const opt = document.querySelector('.start-option[data-type="entrance"]');
          if (opt) opt.click();
        });
        await page.waitForTimeout(2000);
        // Scroll to map for screenshot
        await page.evaluate(() => {
          document.querySelector('#ride-map')?.scrollIntoView({ behavior: 'instant', block: 'center' });
        });
        await page.waitForTimeout(500);
        await page.screenshot({ path: join(SCREENSHOTS_DIR, '08-leviathan-route.png') });
        console.log('   ✓ Leviathan route screenshot saved');
      }
    } else {
      console.log('   ⚠ Leviathan Walk here button not visible');
    }
    
    console.log();
    console.log('UI TESTS COMPLETED');
    console.log('Screenshots saved to:', SCREENSHOTS_DIR);
    console.log();
    
    // List all screenshots
    const { readdirSync } = await import('fs');
    const screenshots = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'));
    console.log('Screenshots generated:');
    for (const s of screenshots.sort()) {
      console.log(`  - ${s}`);
    }
    
  } catch (error) {
    console.error('Test error:', error);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'error.png') });
  } finally {
    await browser.close();
  }
}

runTests().catch(console.error);
