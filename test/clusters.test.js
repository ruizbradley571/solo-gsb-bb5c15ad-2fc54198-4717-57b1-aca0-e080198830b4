'use strict';

const assert = require('assert');
const { buildClusters, articulationPoints } = require('../src/clusters');
const { analyze } = require('../src/analysis');

// ---- 构造冲突记录的辅助 ----
let seq = 0;
function conflict(zoneA, zoneB, type = 'spatial', overlapDays = 5) {
  seq += 1;
  return {
    id: `conflict-${seq}`,
    conflictType: type,
    zones: [
      { id: zoneA[0], name: zoneA[1], layer: 'L' },
      { id: zoneB[0], name: zoneB[1], layer: 'L' },
    ],
    overlapDays,
  };
}
const z = (id) => [id, id.toUpperCase()];

function square(lon1, lat1, lon2, lat2) {
  return {
    type: 'Polygon',
    coordinates: [[[lon1, lat1], [lon2, lat1], [lon2, lat2], [lon1, lat2], [lon1, lat1]]],
  };
}

// 1. 链式 A-B-C：一个集群，B 为关键区域（割点）
let cls = buildClusters([
  conflict(z('a'), z('b')),
  conflict(z('b'), z('c')),
]);
assert.strictEqual(cls.length, 1);
assert.strictEqual(cls[0].id, 'cluster-1');
assert.deepStrictEqual(cls[0].zoneIds, ['a', 'b', 'c']);
assert.strictEqual(cls[0].zoneCount, 3);
assert.strictEqual(cls[0].edgeCount, 2);
assert.strictEqual(cls[0].conflictCount, 2);
assert.deepStrictEqual(cls[0].criticalZoneIds, ['b'], '链式结构中间节点应为割点');
assert.deepStrictEqual(cls[0].criticalZones.map((x) => x.id), ['b']);
assert.strictEqual(cls[0].totalOverlapDays, 10);

// 2. 三角形环：无关键区域（移除任一节点集群仍连通）
cls = buildClusters([
  conflict(z('a'), z('b')),
  conflict(z('b'), z('c')),
  conflict(z('c'), z('a')),
]);
assert.strictEqual(cls.length, 1);
assert.deepStrictEqual(cls[0].criticalZoneIds, [], '环形结构无割点');

// 3. 同一对区域不得因冲突类型形成重复边；冲突记录仍全部计入
cls = buildClusters([
  conflict(z('a'), z('b'), 'spatial'),
  conflict(z('a'), z('b'), 'resource'), // 同一对区域的第二种类型
  conflict(z('b'), z('c'), 'both'),
]);
assert.strictEqual(cls.length, 1);
assert.strictEqual(cls[0].edgeCount, 2, 'a-b 之间只应有一条无向边');
assert.strictEqual(cls[0].conflictCount, 3, '冲突记录不去重，全部保留');
assert.deepStrictEqual(cls[0].conflictCountByType, { spatial: 1, resource: 1, both: 1 });
assert.deepStrictEqual(cls[0].criticalZoneIds, ['b']);
assert.strictEqual(cls[0].totalOverlapDays, 15);

// 4. 两个互不相连的冲突对 → 两个集群；两节点集群无割点
cls = buildClusters([
  conflict(z('a'), z('b')),
  conflict(z('x'), z('y')),
]);
assert.strictEqual(cls.length, 2);
assert.strictEqual(cls[0].zoneCount, 2);
assert.deepStrictEqual(cls[0].criticalZoneIds, [], '仅两个区域的集群无割点');
assert.deepStrictEqual(cls[1].criticalZoneIds, []);

// 5. 排序：冲突数降序；并列时按最小区域 ID 升序（稳定）
cls = buildClusters([
  conflict(z('m2'), z('m1')),             // 集群 X：1 处冲突，min id = m1
  conflict(z('a9'), z('a1')),             // 集群 Y：1 处冲突，min id = a1
  conflict(z('z8'), z('z9')),
  conflict(z('z8'), z('z7')),             // 集群 Z：2 处冲突，min id = z7
]);
assert.strictEqual(cls.length, 3);
assert.strictEqual(cls[0].conflictCount, 2, '冲突数多的集群在前');
assert.deepStrictEqual(cls[0].zoneIds, ['z7', 'z8', 'z9']);
assert.deepStrictEqual(cls[1].zoneIds, ['a1', 'a9'], '并列时最小区域 ID 小者在前');
assert.deepStrictEqual(cls[2].zoneIds, ['m1', 'm2']);
assert.deepStrictEqual(cls.map((c) => c.id), ['cluster-1', 'cluster-2', 'cluster-3']);

// 6. 哑铃结构：环 + 尾巴，连接处为割点
cls = buildClusters([
  conflict(z('a'), z('b')),
  conflict(z('b'), z('c')),
  conflict(z('c'), z('d')),
  conflict(z('d'), z('b')), // b-c-d 成环，a 挂在 b 上
]);
assert.deepStrictEqual(cls[0].criticalZoneIds, ['b'], '环上挂尾巴的连接点为割点');

// 7. 长链 a-b-c-d-e：中间三点均为割点
cls = buildClusters([
  conflict(z('a'), z('b')),
  conflict(z('b'), z('c')),
  conflict(z('c'), z('d')),
  conflict(z('d'), z('e')),
]);
assert.deepStrictEqual(cls[0].criticalZoneIds, ['b', 'c', 'd']);

// 8. 空冲突 → 无集群；孤立区域不成集群
assert.deepStrictEqual(buildClusters([]), []);
assert.deepStrictEqual(buildClusters([conflict(z('a'), z('b'))]).length, 1);

// 9. articulationPoints 直接验证：星形结构中心为割点
const starAdj = new Map([
  ['c', new Set(['l1', 'l2', 'l3'])],
  ['l1', new Set(['c'])],
  ['l2', new Set(['c'])],
  ['l3', new Set(['c'])],
]);
assert.deepStrictEqual(articulationPoints(['c', 'l1', 'l2', 'l3'], starAdj), ['c']);

// 10. analyze 集成：空间冲突 + 资源冲突构成链式集群，z2 为关键区域
const chainZones = [
  {
    id: 'z1', name: 'Z1', layer: '土建',
    start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z',
    geometry: square(121.470, 31.228, 121.474, 31.231),
  },
  {
    id: 'z2', name: 'Z2', layer: '土建',
    start: '2026-10-15T00:00:00.000Z', end: '2026-11-15T00:00:00.000Z',
    resources: ['塔吊'],
    geometry: square(121.472, 31.229, 121.476, 31.232), // 与 z1 空间冲突
  },
  {
    id: 'z3', name: 'Z3', layer: '市政',
    start: '2026-10-20T00:00:00.000Z', end: '2026-11-20T00:00:00.000Z',
    resources: ['塔吊'],
    geometry: square(121.500, 31.250, 121.504, 31.253), // 与 z2 资源冲突，空间远离
  },
  {
    id: 'z9', name: 'Z9', layer: '临建', // 与任何区域无冲突，不应出现在集群中
    start: '2027-01-01T00:00:00.000Z', end: '2027-01-31T00:00:00.000Z',
    geometry: square(121.600, 31.300, 121.604, 31.303),
  },
];
let result = analyze(chainZones);
assert.strictEqual(result.conflictCount, 2);
assert.ok(Array.isArray(result.clusters), 'analyze 结果应包含 clusters');
assert.strictEqual(result.clusters.length, 1, '链式冲突应构成一个集群');
const cl = result.clusters[0];
assert.deepStrictEqual(cl.zoneIds, ['z1', 'z2', 'z3'], '孤立区域 z9 不应进入集群');
assert.deepStrictEqual(cl.criticalZoneIds, ['z2'], 'z2 为链式集群的关键区域');
assert.strictEqual(cl.conflictCount, 2);
assert.strictEqual(cl.edgeCount, 2);
assert.deepStrictEqual(cl.conflictCountByType, { spatial: 1, resource: 1, both: 0 });
assert.deepStrictEqual(
  [...cl.conflictIds].sort(),
  result.conflicts.map((c) => c.id).sort(),
  '集群应引用最终排序后的冲突 id'
);
assert.ok(cl.totalOverlapDays > 0);

// 11. analyze 集成：两个独立冲突对 → 两个集群，按冲突数/min zone id 排序
result = analyze([
  ...chainZones.slice(0, 3), // 集群一：z1-z2-z3（2 处冲突）
  {
    id: 'a1', name: 'A1', layer: '市政',
    start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z',
    resources: ['泵车'],
    geometry: square(121.700, 31.400, 121.704, 31.403),
  },
  {
    id: 'a2', name: 'A2', layer: '机电',
    start: '2026-10-10T00:00:00.000Z', end: '2026-11-10T00:00:00.000Z',
    resources: ['泵车'],
    geometry: square(121.800, 31.500, 121.804, 31.503), // 与 a1 纯资源冲突
  },
]);
assert.strictEqual(result.clusters.length, 2);
assert.strictEqual(result.clusters[0].conflictCount, 2, '冲突数多的集群排前');
assert.deepStrictEqual(result.clusters[0].zoneIds, ['z1', 'z2', 'z3']);
assert.strictEqual(result.clusters[1].conflictCount, 1);
assert.deepStrictEqual(result.clusters[1].zoneIds, ['a1', 'a2']);
assert.deepStrictEqual(result.clusters[1].criticalZoneIds, []);

// 12. 无冲突时 analyze 返回空集群数组
result = analyze([chainZones[0], chainZones[3]]);
assert.strictEqual(result.conflictCount, 0);
assert.deepStrictEqual(result.clusters, []);

console.log('✅ 集群测试全部通过');
