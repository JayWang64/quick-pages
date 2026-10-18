#!/usr/bin/env node
/**
 * Test routes from the new entrance location (Guest Services / FunPix)
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

// Target rides for route testing
const TARGET_RIDES = [
  { id: 'behemoth', name: 'Behemoth' },
  { id: 'yukon-striker', name: 'Yukon Striker' },
  { id: 'leviathan', name: 'Leviathan' },
  { id: 'wonder-mountain-s-guardian', name: "Wonder Mountain's Guardian" },
  { id: 'flying-eagles', name: 'Flying Eagles' }
];

async function testEntranceRoutes() {
  console.log('Testing routes from Main Entrance (Guest Services / FunPix)');
  console.log('Expected entrance coords: lat 43.84309, lng -79.53922');
  console.log('');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36',
    hasTouch: true
  });
  
  const page = await context.newPage();
  
  try {
    console.log('Loading page...');
    await page.goto(`${BASE_URL}/index.html`);
    await page.waitForSelector('.ride-row', { timeout: 15000 });
    await page.waitForTimeout(2000);
    
    // Check entrance coordinates
    const entranceCoords = await page.evaluate(() => PARK_ENTRANCE);
    console.log(`Entrance coordinates: lat ${entranceCoords.lat}, lng ${entranceCoords.lng}`);
    
    const expectedLat = 43.84309;
    const expectedLng = -79.53922;
    const latDiff = Math.abs(entranceCoords.lat - expectedLat);
    const lngDiff = Math.abs(entranceCoords.lng - expectedLng);
    
    if (latDiff < 0.0001 && lngDiff < 0.0001) {
      console.log('✓ Entrance coordinates match expected location');
    } else {
      console.log(`✗ Entrance coordinates mismatch! Expected ${expectedLat}, ${expectedLng}`);
    }
    console.log('');
    
    // Test routes to each ride
    for (const ride of TARGET_RIDES) {
      console.log(`Testing route to ${ride.name}...`);
      
      // Request directions
      await page.evaluate((rideId) => handleWalkHereClick(rideId), ride.id);
      await page.waitForTimeout(500);
      
      // Select entrance as start
      await page.evaluate(() => {
        const opt = document.querySelector('.start-option[data-type="entrance"]');
        if (opt) opt.click();
      });
      await page.waitForTimeout(3000);
      
      // Check route details
      const routeInfo = await page.evaluate(() => {
        if (!currentRoute || !currentRoute.route) return null;
        const startNodeIdx = currentRoute.route.path[0];
        const startNode = walkGraph.nodes[startNodeIdx];
        return {
          startName: currentRoute.startName,
          endName: currentRoute.endName,
          distance: currentRoute.route.distance,
          startNodeLat: startNode.lat,
          startNodeLng: startNode.lng
        };
      });
      
      if (routeInfo) {
        console.log(`  Route: ${routeInfo.startName} → ${routeInfo.endName}`);
        console.log(`  Distance: ${Math.round(routeInfo.distance)}m`);
        console.log(`  Start node: ${routeInfo.startNodeLat.toFixed(5)}, ${routeInfo.startNodeLng.toFixed(5)}`);
        
        // Check if start node is near Guest Services area (should be close to 43.843, -79.539)
        if (routeInfo.startNodeLat > 43.842 && routeInfo.startNodeLat < 43.844) {
          console.log('  ✓ Route starts from Guest Services area');
        } else {
          console.log('  ✗ Route may not start from correct location!');
        }
        
        // Take screenshot
        const filename = `entrance-route-${ride.id}.png`;
        await page.screenshot({ path: join(SCREENSHOTS_DIR, filename) });
        console.log(`  Screenshot: ${filename}`);
      } else {
        console.log(`  ✗ No route found for ${ride.name}`);
      }
      
      // Clear route
      await page.evaluate(() => handleClearRoute());
      await page.waitForTimeout(500);
      console.log('');
    }
    
    console.log('=== Entrance marker test ===');
    // Take screenshot showing entrance marker
    await page.evaluate(() => {
      map.setView([43.84309, -79.53922], 17);
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'entrance-marker.png') });
    console.log('Entrance marker screenshot saved');
    
    console.log('\n✓ All entrance route tests completed');
    
  } catch (error) {
    console.error('Test error:', error.message);
    await page.screenshot({ path: join(SCREENSHOTS_DIR, 'entrance-error.png') });
  } finally {
    await context.close();
    await browser.close();
  }
}

testEntranceRoutes().catch(console.error);
