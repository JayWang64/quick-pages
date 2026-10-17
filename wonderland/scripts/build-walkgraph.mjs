#!/usr/bin/env node
/**
 * Build a walk graph JSON from OpenStreetMap data for Canada's Wonderland.
 * 
 * Usage:
 *   node scripts/build-walkgraph.mjs
 *   node scripts/build-walkgraph.mjs --fetch   # Re-fetch OSM data first
 * 
 * Input: scripts/osm-raw.json (Overpass API output)
 * Output: public/walkgraph.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OSM_RAW_PATH = join(__dirname, 'osm-raw.json');
const OUTPUT_PATH = join(__dirname, '..', 'public', 'walkgraph.json');
const RIDES_PATH = join(__dirname, '..', 'public', 'rides.json');

// Park bounding box (extended slightly beyond ride locations)
const BBOX = {
  south: 43.833,
  west: -79.560,
  north: 43.850,
  east: -79.533
};

// Snap endpoints within this distance (meters)
const SNAP_DISTANCE_M = 8;

// Walking-friendly highway types
const WALKABLE_HIGHWAYS = new Set([
  'footway', 'pedestrian', 'path', 'steps', 'service',
  'living_street', 'residential', 'unclassified', 'track',
  'corridor', 'crossing'
]);

// Exclusion rules
function isWalkable(way) {
  const tags = way.tags || {};
  const highway = tags.highway;
  
  if (!WALKABLE_HIGHWAYS.has(highway)) return false;
  
  // Exclude if access=private/no unless foot=yes
  const access = tags.access;
  const foot = tags.foot;
  if ((access === 'private' || access === 'no') && foot !== 'yes') {
    return false;
  }
  
  // Exclude if foot=no explicitly
  if (foot === 'no') return false;
  
  // Exclude motor-only service ways
  if (highway === 'service') {
    const service = tags.service;
    if (service === 'drive-through' || service === 'parking_aisle') {
      // Allow these but with lower preference later
    }
    // Still allow most service ways for park paths
  }
  
  return true;
}

// Haversine distance in meters
function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Fetch OSM data from Overpass API
function fetchOsmData() {
  const query = `
[out:json][timeout:60];
(
  way["highway"="footway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="pedestrian"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="path"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="steps"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="service"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="living_street"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="residential"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="unclassified"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="track"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="corridor"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["highway"="crossing"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out body;
>;
out skel qt;
`.trim();

  console.log('Fetching OSM data from Overpass API...');
  const result = execSync(`curl -X POST \\
    -H "User-Agent: CanadasWonderlandWalkDirections/1.0 (github.com/jaywang64/quick-pages)" \\
    --data-urlencode 'data=${query.replace(/'/g, "'\\''")}' \\
    "https://overpass-api.de/api/interpreter"`, {
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf8'
  });
  
  writeFileSync(OSM_RAW_PATH, result);
  console.log('OSM data saved to', OSM_RAW_PATH);
  return JSON.parse(result);
}

// Build graph from OSM data
function buildGraph(osmData) {
  const elements = osmData.elements || [];
  
  // Separate nodes and ways
  const nodeMap = new Map(); // OSM node id -> {lat, lon}
  const ways = [];
  
  for (const el of elements) {
    if (el.type === 'node') {
      nodeMap.set(el.id, { lat: el.lat, lon: el.lon });
    } else if (el.type === 'way' && isWalkable(el)) {
      ways.push(el);
    }
  }
  
  console.log(`Parsed ${nodeMap.size} nodes and ${ways.length} walkable ways`);
  
  // Build graph: nodes are OSM node ids, edges connect consecutive nodes in ways
  const graph = {
    nodes: new Map(), // nodeId -> {lat, lon, edges: Set<nodeId>}
    edges: []         // {from, to, length}
  };
  
  for (const way of ways) {
    const nodes = way.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const nodeId = nodes[i];
      const coord = nodeMap.get(nodeId);
      if (!coord) continue;
      
      if (!graph.nodes.has(nodeId)) {
        graph.nodes.set(nodeId, {
          lat: coord.lat,
          lon: coord.lon,
          edges: new Set()
        });
      }
      
      // Connect to previous node
      if (i > 0) {
        const prevId = nodes[i - 1];
        const prevCoord = nodeMap.get(prevId);
        if (prevCoord && graph.nodes.has(prevId)) {
          const dist = haversineM(prevCoord.lat, prevCoord.lon, coord.lat, coord.lon);
          
          // Add bidirectional edges (unless way is oneway)
          const oneway = way.tags?.oneway;
          graph.nodes.get(prevId).edges.add(nodeId);
          if (oneway !== 'yes') {
            graph.nodes.get(nodeId).edges.add(prevId);
          }
          
          graph.edges.push({
            from: prevId,
            to: nodeId,
            length: dist,
            bidirectional: oneway !== 'yes'
          });
        }
      }
    }
  }
  
  console.log(`Initial graph: ${graph.nodes.size} nodes, ${graph.edges.length} edges`);
  return graph;
}

// Find endpoints (nodes with degree 1)
function findEndpoints(graph) {
  const endpoints = [];
  for (const [nodeId, node] of graph.nodes) {
    if (node.edges.size === 1) {
      endpoints.push(nodeId);
    }
  }
  return endpoints;
}

// Build spatial index for snapping
function buildSpatialIndex(graph) {
  const index = [];
  for (const [nodeId, node] of graph.nodes) {
    index.push({ id: nodeId, lat: node.lat, lon: node.lon });
  }
  return index;
}

// Find nearest node within distance threshold
function findNearestNode(lat, lon, spatialIndex, maxDist, excludeId = null) {
  let best = null;
  let bestDist = maxDist;
  
  for (const node of spatialIndex) {
    if (node.id === excludeId) continue;
    const dist = haversineM(lat, lon, node.lat, node.lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }
  
  return best ? { id: best.id, dist: bestDist } : null;
}

// Snap nearby endpoints to connect disconnected paths
function snapEndpoints(graph, snapDist) {
  const endpoints = findEndpoints(graph);
  const spatialIndex = buildSpatialIndex(graph);
  let snapped = 0;
  
  console.log(`Found ${endpoints.length} endpoint nodes (degree 1)`);
  
  for (const endpointId of endpoints) {
    const node = graph.nodes.get(endpointId);
    if (!node) continue;
    
    // Find nearest node that's not this one and not already connected
    const nearest = findNearestNode(node.lat, node.lon, spatialIndex, snapDist, endpointId);
    
    if (nearest && !node.edges.has(nearest.id)) {
      // Add snap edge
      node.edges.add(nearest.id);
      graph.nodes.get(nearest.id).edges.add(endpointId);
      graph.edges.push({
        from: endpointId,
        to: nearest.id,
        length: nearest.dist,
        bidirectional: true,
        snapped: true
      });
      snapped++;
    }
  }
  
  console.log(`Snapped ${snapped} endpoints within ${snapDist}m`);
  return snapped;
}

// Find connected components using BFS
function findConnectedComponents(graph) {
  const visited = new Set();
  const components = [];
  
  for (const nodeId of graph.nodes.keys()) {
    if (visited.has(nodeId)) continue;
    
    const component = new Set();
    const queue = [nodeId];
    
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      
      visited.add(current);
      component.add(current);
      
      const node = graph.nodes.get(current);
      if (node) {
        for (const neighbor of node.edges) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
    }
    
    components.push(component);
  }
  
  components.sort((a, b) => b.size - a.size);
  return components;
}

// Find the component that contains the most rides
function findBestComponentForRides(graph, components, ridesPath) {
  if (!existsSync(ridesPath)) {
    console.log('rides.json not found, using largest component');
    return components[0];
  }
  
  const ridesData = JSON.parse(readFileSync(ridesPath, 'utf8'));
  const rides = ridesData.rides || [];
  const spatialIndex = buildSpatialIndex(graph);
  
  // Count rides per component
  const componentScores = components.map((comp, idx) => {
    let count = 0;
    let totalDist = 0;
    const coveredRides = [];
    for (const ride of rides) {
      if (!ride.location?.lat || !ride.location?.lng) continue;
      
      // Find nearest node in this component
      let best = null;
      let bestDist = 100; // 100m max
      for (const node of spatialIndex) {
        if (!comp.has(node.id)) continue;
        const dist = haversineM(ride.location.lat, ride.location.lng, node.lat, node.lon);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      if (best) {
        count++;
        totalDist += bestDist;
        coveredRides.push(ride.name);
      }
    }
    return { idx, comp, size: comp.size, rideCount: count, avgDist: count > 0 ? totalDist / count : Infinity, coveredRides };
  });
  
  // Sort by ride count (desc), then by avg distance (asc)
  componentScores.sort((a, b) => {
    if (b.rideCount !== a.rideCount) return b.rideCount - a.rideCount;
    return a.avgDist - b.avgDist;
  });
  
  console.log('\nTop components by ride coverage:');
  for (let i = 0; i < Math.min(5, componentScores.length); i++) {
    const s = componentScores[i];
    console.log(`  Component ${s.idx + 1}: ${s.size} nodes, ${s.rideCount} rides, avg dist ${Math.round(s.avgDist)}m`);
  }
  
  // Merge all components that have at least 1 ride within 100m
  const mergedSet = new Set();
  let mergedCount = 0;
  for (const score of componentScores) {
    if (score.rideCount >= 1) {
      for (const nodeId of score.comp) {
        mergedSet.add(nodeId);
      }
      mergedCount++;
    }
  }
  
  console.log(`\nMerging ${mergedCount} components with rides (${mergedSet.size} nodes total)`);
  
  return mergedSet;
}

// Connect nearby components by adding virtual edges between closest endpoints
function connectNearbyComponents(graph, components, maxDist = 50) {
  console.log('\nConnecting nearby components...');
  let connected = 0;
  
  // Build component map
  const nodeToComponent = new Map();
  for (let i = 0; i < components.length; i++) {
    for (const nodeId of components[i]) {
      nodeToComponent.set(nodeId, i);
    }
  }
  
  // Find endpoints in each component
  const componentEndpoints = components.map((comp, idx) => {
    const endpoints = [];
    for (const nodeId of comp) {
      const node = graph.nodes.get(nodeId);
      if (!node) continue;
      // Include nodes with degree 1-2 (endpoints and near-endpoints)
      if (node.edges.size <= 2) {
        endpoints.push({ id: nodeId, lat: node.lat, lon: node.lon, compIdx: idx });
      }
    }
    return endpoints;
  });
  
  // For each pair of different components, try to connect their closest endpoints
  const connectedPairs = new Set();
  for (let i = 0; i < components.length; i++) {
    for (let j = i + 1; j < components.length; j++) {
      let bestDist = maxDist;
      let bestPair = null;
      
      for (const ep1 of componentEndpoints[i]) {
        for (const ep2 of componentEndpoints[j]) {
          const dist = haversineM(ep1.lat, ep1.lon, ep2.lat, ep2.lon);
          if (dist < bestDist) {
            bestDist = dist;
            bestPair = { from: ep1.id, to: ep2.id, dist };
          }
        }
      }
      
      if (bestPair) {
        const pairKey = [Math.min(i, j), Math.max(i, j)].join('-');
        if (!connectedPairs.has(pairKey)) {
          connectedPairs.add(pairKey);
          
          // Add bidirectional edge
          graph.nodes.get(bestPair.from).edges.add(bestPair.to);
          graph.nodes.get(bestPair.to).edges.add(bestPair.from);
          graph.edges.push({
            from: bestPair.from,
            to: bestPair.to,
            length: bestPair.dist,
            bidirectional: true,
            connected: true
          });
          connected++;
        }
      }
    }
  }
  
  console.log(`Connected ${connected} component pairs within ${maxDist}m`);
  return connected;
}

// Check which rides are reachable from the main component
function checkRideConnectivity(graph, mainComponent, ridesPath) {
  if (!existsSync(ridesPath)) {
    console.log('rides.json not found, skipping ride connectivity check');
    return;
  }
  
  const ridesData = JSON.parse(readFileSync(ridesPath, 'utf8'));
  const rides = ridesData.rides || [];
  const spatialIndex = buildSpatialIndex(graph);
  
  const results = {
    connected: [],
    disconnected: [],
    noCoords: [],
    distanceWarnings: []
  };
  
  for (const ride of rides) {
    if (!ride.location?.lat || !ride.location?.lng) {
      results.noCoords.push(ride.name);
      continue;
    }
    
    const nearest = findNearestNode(
      ride.location.lat,
      ride.location.lng,
      spatialIndex,
      200 // 200m max search radius
    );
    
    if (!nearest) {
      results.disconnected.push({ name: ride.name, reason: 'no nearby node' });
      continue;
    }
    
    if (!mainComponent.has(nearest.id)) {
      results.disconnected.push({ name: ride.name, reason: 'not in main component', dist: nearest.dist });
      continue;
    }
    
    if (nearest.dist > 60) {
      results.distanceWarnings.push({ name: ride.name, dist: Math.round(nearest.dist) });
    }
    
    results.connected.push({ name: ride.name, dist: Math.round(nearest.dist) });
  }
  
  console.log(`\nRide connectivity (${rides.length} total):`);
  console.log(`  Connected: ${results.connected.length}`);
  console.log(`  Distance warnings (>60m): ${results.distanceWarnings.length}`);
  if (results.distanceWarnings.length > 0) {
    for (const w of results.distanceWarnings) {
      console.log(`    - ${w.name}: ${w.dist}m from nearest path`);
    }
  }
  console.log(`  Disconnected: ${results.disconnected.length}`);
  if (results.disconnected.length > 0) {
    for (const d of results.disconnected) {
      console.log(`    - ${d.name}: ${d.reason}${d.dist ? ` (${Math.round(d.dist)}m)` : ''}`);
    }
  }
  console.log(`  No coordinates: ${results.noCoords.length}`);
  
  return results;
}

// Simplify graph: remove intermediate nodes with degree 2
function simplifyGraph(graph) {
  const toRemove = [];
  const edgeUpdates = [];
  
  for (const [nodeId, node] of graph.nodes) {
    if (node.edges.size !== 2) continue;
    
    const neighbors = Array.from(node.edges);
    const n1 = graph.nodes.get(neighbors[0]);
    const n2 = graph.nodes.get(neighbors[1]);
    
    if (!n1 || !n2) continue;
    
    // Calculate total distance through this node
    const dist1 = haversineM(n1.lat, n1.lon, node.lat, node.lon);
    const dist2 = haversineM(node.lat, node.lon, n2.lat, n2.lon);
    const totalDist = dist1 + dist2;
    
    // Mark for removal and record edge update
    toRemove.push(nodeId);
    edgeUpdates.push({
      remove: [nodeId],
      add: { from: neighbors[0], to: neighbors[1], length: totalDist }
    });
  }
  
  // Apply simplification
  for (const update of edgeUpdates) {
    const nodeId = update.remove[0];
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    
    const neighbors = Array.from(node.edges);
    const n1 = graph.nodes.get(neighbors[0]);
    const n2 = graph.nodes.get(neighbors[1]);
    
    if (!n1 || !n2) continue;
    
    // Connect neighbors directly
    n1.edges.delete(nodeId);
    n2.edges.delete(nodeId);
    n1.edges.add(neighbors[1]);
    n2.edges.add(neighbors[0]);
    
    // Remove node
    graph.nodes.delete(nodeId);
  }
  
  // Rebuild edges list
  graph.edges = [];
  const seenEdges = new Set();
  
  for (const [nodeId, node] of graph.nodes) {
    for (const neighborId of node.edges) {
      const edgeKey = [Math.min(nodeId, neighborId), Math.max(nodeId, neighborId)].join('-');
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      
      const neighbor = graph.nodes.get(neighborId);
      if (!neighbor) continue;
      
      const dist = haversineM(node.lat, node.lon, neighbor.lat, neighbor.lon);
      graph.edges.push({ from: nodeId, to: neighborId, length: dist });
    }
  }
  
  console.log(`After simplification: ${graph.nodes.size} nodes, ${graph.edges.length} edges`);
  return toRemove.length;
}

// Export graph to compact JSON format, ensuring full connectivity
function exportGraph(graph, mainComponent, outputPath) {
  // Only include nodes from main component
  const nodeIdToIndex = new Map();
  const indexToNodeId = new Map();
  const nodes = [];
  
  let idx = 0;
  for (const [nodeId, node] of graph.nodes) {
    if (!mainComponent.has(nodeId)) continue;
    
    nodeIdToIndex.set(nodeId, idx);
    indexToNodeId.set(idx, nodeId);
    nodes.push({
      lat: Math.round(node.lat * 1e6) / 1e6,
      lng: Math.round(node.lon * 1e6) / 1e6
    });
    idx++;
  }
  
  // Build edges using indices
  const edges = [];
  const seenEdges = new Set();
  
  for (const [nodeId, node] of graph.nodes) {
    if (!mainComponent.has(nodeId)) continue;
    
    const fromIdx = nodeIdToIndex.get(nodeId);
    
    for (const neighborId of node.edges) {
      if (!mainComponent.has(neighborId)) continue;
      
      const toIdx = nodeIdToIndex.get(neighborId);
      const edgeKey = [Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx)].join('-');
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);
      
      const neighbor = graph.nodes.get(neighborId);
      if (!neighbor) continue;
      
      const dist = haversineM(node.lat, node.lon, neighbor.lat, neighbor.lon);
      edges.push([fromIdx, toIdx, Math.round(dist * 10) / 10]);
    }
  }
  
  // Ensure full connectivity by finding and connecting components
  console.log('Ensuring graph connectivity...');
  
  // Build adjacency for exported graph
  const adj = new Map();
  for (let i = 0; i < nodes.length; i++) {
    adj.set(i, new Set());
  }
  for (const [from, to] of edges) {
    adj.get(from).add(to);
    adj.get(to).add(from);
  }
  
  // Find components in exported graph
  const visited = new Set();
  const exportComponents = [];
  
  for (let i = 0; i < nodes.length; i++) {
    if (visited.has(i)) continue;
    
    const comp = [];
    const queue = [i];
    
    while (queue.length > 0) {
      const n = queue.shift();
      if (visited.has(n)) continue;
      visited.add(n);
      comp.push(n);
      
      for (const neighbor of adj.get(n)) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    
    exportComponents.push(comp);
  }
  
  console.log(`  Found ${exportComponents.length} components in export set`);
  
  // Connect components by adding edges between closest nodes
  if (exportComponents.length > 1) {
    exportComponents.sort((a, b) => b.length - a.length);
    const mainComp = new Set(exportComponents[0]);
    let connectionsAdded = 0;
    
    for (let c = 1; c < exportComponents.length; c++) {
      const otherComp = exportComponents[c];
      let bestDist = Infinity;
      let bestPair = null;
      
      // Find closest pair between main and other component
      for (const mainIdx of mainComp) {
        const mainNode = nodes[mainIdx];
        for (const otherIdx of otherComp) {
          const otherNode = nodes[otherIdx];
          const dist = haversineM(mainNode.lat, mainNode.lng, otherNode.lat, otherNode.lng);
          if (dist < bestDist) {
            bestDist = dist;
            bestPair = { from: mainIdx, to: otherIdx };
          }
        }
      }
      
      if (bestPair && bestDist < 500) { // 500m max connection distance
        const edgeKey = [Math.min(bestPair.from, bestPair.to), Math.max(bestPair.from, bestPair.to)].join('-');
        if (!seenEdges.has(edgeKey)) {
          seenEdges.add(edgeKey);
          edges.push([bestPair.from, bestPair.to, Math.round(bestDist * 10) / 10]);
          connectionsAdded++;
        }
        // Merge other component into main
        for (const idx of otherComp) {
          mainComp.add(idx);
        }
      }
    }
    
    console.log(`  Added ${connectionsAdded} connecting edges`);
  }
  
  const output = {
    version: 1,
    generated: new Date().toISOString(),
    bbox: BBOX,
    nodes,
    edges
  };
  
  const json = JSON.stringify(output);
  writeFileSync(outputPath, json);
  
  const sizeKb = Math.round(json.length / 1024);
  console.log(`\nExported to ${outputPath}`);
  console.log(`  ${nodes.length} nodes, ${edges.length} edges`);
  console.log(`  File size: ${sizeKb} KB`);
  
  return output;
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const shouldFetch = args.includes('--fetch');
  
  // Load or fetch OSM data
  let osmData;
  if (shouldFetch || !existsSync(OSM_RAW_PATH)) {
    osmData = fetchOsmData();
  } else {
    console.log('Loading existing OSM data from', OSM_RAW_PATH);
    osmData = JSON.parse(readFileSync(OSM_RAW_PATH, 'utf8'));
  }
  
  // Build graph
  console.log('\nBuilding walk graph...');
  const graph = buildGraph(osmData);
  
  // Snap endpoints multiple times to connect more paths
  console.log('\nSnapping endpoints...');
  for (let i = 0; i < 3; i++) {
    const snapped = snapEndpoints(graph, SNAP_DISTANCE_M);
    if (snapped === 0) break;
  }
  
  // Find connected components (initial)
  console.log('\nFinding connected components (initial)...');
  let components = findConnectedComponents(graph);
  console.log(`Found ${components.length} connected components`);
  
  // Try to connect nearby components multiple times
  for (let round = 0; round < 3; round++) {
    const connected = connectNearbyComponents(graph, components, 50);
    if (connected === 0) break;
    components = findConnectedComponents(graph);
    console.log(`After round ${round + 1}: ${components.length} components`);
  }
  
  console.log(`\nFinal: ${components.length} connected components`);
  console.log(`Largest component: ${components[0].size} nodes (${Math.round(components[0].size / graph.nodes.size * 100)}%)`);
  
  if (components.length > 1) {
    console.log('Component sizes:');
    for (let i = 0; i < Math.min(components.length, 6); i++) {
      console.log(`  Component ${i + 1}: ${components[i].size} nodes`);
    }
    if (components.length > 6) {
      console.log(`  ... and ${components.length - 6} more small components`);
    }
  }
  
  // Find the best component for rides (not necessarily the largest)
  const mainComponent = findBestComponentForRides(graph, components, RIDES_PATH);
  
  // Check ride connectivity
  const rideConnectivity = checkRideConnectivity(graph, mainComponent, RIDES_PATH);
  
  // Simplify graph (optional - can reduce file size but loses path detail)
  // console.log('\nSimplifying graph...');
  // simplifyGraph(graph);
  
  // Export to JSON
  console.log('\nExporting graph...');
  exportGraph(graph, mainComponent, OUTPUT_PATH);
  
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
