#!/usr/bin/env node
/**
 * Routing quality tests for Canada's Wonderland walking directions.
 * 
 * Tests:
 * 1. Route between well-known ride pairs
 * 2. Verify all rides snap to graph within acceptable distance
 * 3. Check route quality (route vs straight-line ratio)
 * 
 * Usage:
 *   node scripts/test-routing.mjs
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GRAPH_PATH = join(__dirname, '..', 'public', 'walkgraph.json');
const RIDES_PATH = join(__dirname, '..', 'public', 'rides.json');

// Haversine distance in meters
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Load data
const graph = JSON.parse(readFileSync(GRAPH_PATH, 'utf8'));
const ridesData = JSON.parse(readFileSync(RIDES_PATH, 'utf8'));
const rides = ridesData.rides;

// Build adjacency list
const adj = [];
for (let i = 0; i < graph.nodes.length; i++) {
  adj[i] = [];
}
for (const [from, to, dist] of graph.edges) {
  adj[from].push({ node: to, dist });
  adj[to].push({ node: from, dist });
}

// Find nearest graph node
function findNearestNode(lat, lng) {
  let bestIdx = -1;
  let bestDist = Infinity;
  
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    const dist = haversineM(lat, lng, node.lat, node.lng);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  
  return { idx: bestIdx, dist: bestDist };
}

// A* routing
function findRoute(startIdx, endIdx) {
  const nodes = graph.nodes;
  const endNode = nodes[endIdx];
  const heuristic = (idx) => haversineM(nodes[idx].lat, nodes[idx].lng, endNode.lat, endNode.lng);
  
  const gScore = new Array(nodes.length).fill(Infinity);
  const fScore = new Array(nodes.length).fill(Infinity);
  const cameFrom = new Array(nodes.length).fill(-1);
  
  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startIdx);
  
  const openSet = [{ idx: startIdx, f: fScore[startIdx] }];
  const inOpen = new Set([startIdx]);
  const closed = new Set();
  
  while (openSet.length > 0) {
    openSet.sort((a, b) => a.f - b.f);
    const current = openSet.shift();
    inOpen.delete(current.idx);
    
    if (current.idx === endIdx) {
      const path = [];
      let node = endIdx;
      while (node >= 0) {
        path.unshift(node);
        node = cameFrom[node];
      }
      return { path, distance: gScore[endIdx] };
    }
    
    closed.add(current.idx);
    
    for (const neighbor of adj[current.idx]) {
      if (closed.has(neighbor.node)) continue;
      
      const tentativeG = gScore[current.idx] + neighbor.dist;
      
      if (tentativeG < gScore[neighbor.node]) {
        cameFrom[neighbor.node] = current.idx;
        gScore[neighbor.node] = tentativeG;
        fScore[neighbor.node] = tentativeG + heuristic(neighbor.node);
        
        if (!inOpen.has(neighbor.node)) {
          openSet.push({ idx: neighbor.node, f: fScore[neighbor.node] });
          inOpen.add(neighbor.node);
        }
      }
    }
  }
  
  return null;
}

// Find ride by name
function findRide(name) {
  return rides.find(r => r.name.toLowerCase().includes(name.toLowerCase()));
}

// Test ride pairs
const RIDE_PAIRS = [
  ['Behemoth', 'Leviathan'],
  ['Wonder Mountain\'s Guardian', 'KidZville Station'],
  ['Backlot Stunt Coaster', 'SlingShot'],
  ['WindSeeker', 'Antique Carrousel'],
  ['Yukon Striker', 'Dragon Fyre'],
  ['Ghoster Coaster', 'Mighty Canadian Minebuster'],
  ['Vortex', 'The Bat'],
  ['Timberwolf Falls', 'White Water Canyon'],
  ['Drop Tower', 'Riptide'],
  ['Silver Streak', 'Flying Eagles']
];

console.log('='.repeat(70));
console.log('ROUTING QUALITY TESTS - Canada\'s Wonderland Walking Directions');
console.log('='.repeat(70));
console.log();

// Test 1: Route between ride pairs
console.log('TEST 1: Routing between well-known ride pairs');
console.log('-'.repeat(70));

let routeTests = { passed: 0, failed: 0, warnings: 0 };
const routeResults = [];

for (const [name1, name2] of RIDE_PAIRS) {
  const ride1 = findRide(name1);
  const ride2 = findRide(name2);
  
  if (!ride1 || !ride2) {
    console.log(`SKIP: Could not find ride "${name1}" or "${name2}"`);
    continue;
  }
  
  if (!ride1.location?.lat || !ride2.location?.lat) {
    console.log(`SKIP: No coordinates for "${ride1.name}" or "${ride2.name}"`);
    continue;
  }
  
  const node1 = findNearestNode(ride1.location.lat, ride1.location.lng);
  const node2 = findNearestNode(ride2.location.lat, ride2.location.lng);
  
  const straightDist = haversineM(
    ride1.location.lat, ride1.location.lng,
    ride2.location.lat, ride2.location.lng
  );
  
  const route = findRoute(node1.idx, node2.idx);
  
  if (!route) {
    console.log(`FAIL: No route found from "${ride1.name}" to "${ride2.name}"`);
    routeTests.failed++;
    routeResults.push({ from: ride1.name, to: ride2.name, status: 'NO ROUTE' });
    continue;
  }
  
  const totalDist = route.distance + node1.dist + node2.dist;
  const ratio = totalDist / straightDist;
  
  let status = 'OK';
  let flag = '';
  if (ratio > 2.5) {
    status = 'WARN';
    flag = ' ⚠️ RATIO > 2.5x';
    routeTests.warnings++;
  } else {
    routeTests.passed++;
  }
  
  routeResults.push({
    from: ride1.name,
    to: ride2.name,
    straight: Math.round(straightDist),
    route: Math.round(totalDist),
    ratio: ratio.toFixed(2),
    status
  });
  
  console.log(`${status}: ${ride1.name} → ${ride2.name}`);
  console.log(`  Straight: ${Math.round(straightDist)}m, Route: ${Math.round(totalDist)}m, Ratio: ${ratio.toFixed(2)}x${flag}`);
}

console.log();
console.log(`Results: ${routeTests.passed} passed, ${routeTests.warnings} warnings, ${routeTests.failed} failed`);
console.log();

// Test 2: Verify all rides snap within 60m
console.log('TEST 2: Ride snap distance (should be ≤ 60m)');
console.log('-'.repeat(70));

let snapTests = { passed: 0, warnings: 0 };
const snapWarnings = [];

for (const ride of rides) {
  if (!ride.location?.lat) continue;
  
  const nearest = findNearestNode(ride.location.lat, ride.location.lng);
  
  if (nearest.dist > 60) {
    snapWarnings.push({ name: ride.name, dist: Math.round(nearest.dist) });
    snapTests.warnings++;
  } else {
    snapTests.passed++;
  }
}

console.log(`Rides within 60m of graph: ${snapTests.passed}/${snapTests.passed + snapTests.warnings}`);

if (snapWarnings.length > 0) {
  console.log();
  console.log('Rides > 60m from nearest path:');
  for (const w of snapWarnings) {
    console.log(`  ⚠️ ${w.name}: ${w.dist}m`);
  }
}

console.log();

// Test 3: Graph connectivity check
console.log('TEST 3: Graph connectivity');
console.log('-'.repeat(70));

const visited = new Set();
let components = 0;

for (let i = 0; i < graph.nodes.length; i++) {
  if (visited.has(i)) continue;
  components++;
  
  const queue = [i];
  while (queue.length > 0) {
    const node = queue.shift();
    if (visited.has(node)) continue;
    visited.add(node);
    for (const neighbor of adj[node]) {
      if (!visited.has(neighbor.node)) queue.push(neighbor.node);
    }
  }
}

console.log(`Connected components: ${components}`);
console.log(`Fully connected: ${components === 1 ? 'YES ✓' : 'NO ✗'}`);
console.log();

// Summary
console.log('='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
console.log(`Rides tested: ${rides.length}`);
console.log(`Route pairs: ${routeResults.length} tested, ${routeTests.warnings} with high ratio (>2.5x)`);
console.log(`Snap distance: ${snapTests.warnings} rides > 60m from path`);
console.log(`Connectivity: ${components === 1 ? 'Fully connected' : `${components} disconnected components`}`);
console.log();

// Output as table for PR
console.log('='.repeat(70));
console.log('ROUTE TEST TABLE (for PR)');
console.log('='.repeat(70));
console.log('| From | To | Straight (m) | Route (m) | Ratio | Status |');
console.log('|------|----|--------------:|----------:|------:|--------|');
for (const r of routeResults) {
  console.log(`| ${r.from} | ${r.to} | ${r.straight || '-'} | ${r.route || '-'} | ${r.ratio || '-'} | ${r.status} |`);
}
console.log();

// Exit with error if critical failures
if (components !== 1 || routeTests.failed > 0) {
  console.log('❌ CRITICAL ISSUES FOUND');
  process.exit(1);
}

if (routeTests.warnings > 2 || snapTests.warnings > 5) {
  console.log('⚠️ WARNINGS - Review needed');
  process.exit(0);
}

console.log('✅ ALL TESTS PASSED');
process.exit(0);
