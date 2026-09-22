'use strict';

/**
 * 冲突协调集群：以区域为节点、冲突为无向边构建无向图，
 * 按连通分量划分集群（仅保留至少含两个区域的分量），
 * 并用 Tarjan 算法识别割点——移除后会拆分集群的关键区域。
 * 同一对区域之间无论存在多少条/多少种类型的冲突，只计一条边（无重复边）。
 */

/** 无向边键：同一对区域（无论冲突类型）只对应一条边；\u0001 分隔避免与 id 字符冲突 */
function edgeKey(a, b) {
  return a < b ? `${a}\u0001${b}` : `${b}\u0001${a}`;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Tarjan 割点算法：在 nodeIds 诱导的连通子图上求全部割点。
 * 割点 = 移除该节点（及其关联边）后，所在集群被拆成更多连通分量的节点。
 * @param {string[]} nodeIds 连通分量内的节点 id
 * @param {Map<string, Set<string>>} adj 全图邻接表（已去重，无平行边）
 * @returns {string[]} 割点 id（按 id 升序，保证输出稳定）
 */
function articulationPoints(nodeIds, adj) {
  const inComp = new Set(nodeIds);
  const disc = new Map();   // 发现时间
  const low = new Map();    // 不经过父节点可达的最早发现时间
  const parent = new Map();
  const points = new Set();
  let time = 0;

  function dfs(u) {
    disc.set(u, time);
    low.set(u, time);
    time += 1;
    let children = 0;
    for (const v of adj.get(u)) {
      if (!inComp.has(v)) continue;
      if (!disc.has(v)) {
        parent.set(v, u);
        children += 1;
        dfs(v);
        low.set(u, Math.min(low.get(u), low.get(v)));
        // 非根节点：某棵子树无法绕过 u 回到其祖先 → u 是割点
        if (parent.has(u) && low.get(v) >= disc.get(u)) points.add(u);
        // 根节点：DFS 树中有超过一棵子树 → 根是割点
        if (!parent.has(u) && children > 1) points.add(u);
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      }
    }
  }

  for (const id of nodeIds) {
    if (!disc.has(id)) dfs(id);
  }
  return [...points].sort();
}

/**
 * 由冲突列表构建协调集群。
 * @param {Array} conflicts analyze() 输出的冲突（zones 含 {id, name, layer}）
 * @returns {Array} 集群列表，按冲突数降序、最小区域 ID 升序稳定排序，
 *   每个集群含区域/冲突 ID、类型计数、累计重叠天数与关键区域（割点）
 */
function buildClusters(conflicts) {
  const nodes = new Map(); // zoneId -> {id, name, layer}
  const adj = new Map();   // zoneId -> Set<zoneId>（Set 保证同一对区域不形成重复边）

  const addNode = (z) => {
    if (!nodes.has(z.id)) {
      nodes.set(z.id, { id: z.id, name: z.name, layer: z.layer });
      adj.set(z.id, new Set());
    }
  };

  const edges = new Set(); // 去重后的无向边集合
  for (const c of conflicts || []) {
    const [za, zb] = c.zones || [];
    if (!za || !zb || !za.id || !zb.id || za.id === zb.id) continue;
    addNode(za);
    addNode(zb);
    adj.get(za.id).add(zb.id);
    adj.get(zb.id).add(za.id);
    edges.add(edgeKey(za.id, zb.id));
  }

  // 连通分量（BFS），记录每个节点所属分量序号
  const compIndexOf = new Map();
  const components = [];
  for (const id of nodes.keys()) {
    if (compIndexOf.has(id)) continue;
    const idx = components.length;
    const comp = [];
    const queue = [id];
    compIndexOf.set(id, idx);
    while (queue.length) {
      const cur = queue.shift();
      comp.push(cur);
      for (const nb of adj.get(cur)) {
        if (!compIndexOf.has(nb)) {
          compIndexOf.set(nb, idx);
          queue.push(nb);
        }
      }
    }
    components.push(comp);
  }

  // 汇总每个分量；单节点分量（无冲突的孤立区域）不构成集群
  const clusters = [];
  components.forEach((comp, idx) => {
    if (comp.length < 2) return;

    const inComp = (zoneId) => compIndexOf.get(zoneId) === idx;
    const compConflicts = conflicts.filter(
      (c) => c.zones && c.zones[0] && inComp(c.zones[0].id)
    );

    const conflictCountByType = { spatial: 0, resource: 0, both: 0 };
    let totalOverlapDays = 0;
    for (const c of compConflicts) {
      if (c.conflictType in conflictCountByType) conflictCountByType[c.conflictType] += 1;
      totalOverlapDays += c.overlapDays || 0;
    }

    const zoneIds = [...comp].sort();
    const criticalZoneIds = articulationPoints(comp, adj);
    const edgeCount = [...edges].filter((key) => {
      const [a, b] = key.split('\u0001');
      return inComp(a) && inComp(b);
    }).length;

    clusters.push({
      zoneIds,
      zones: zoneIds.map((id) => nodes.get(id)),
      zoneCount: zoneIds.length,
      edgeCount,
      conflictIds: compConflicts.map((c) => c.id),
      conflictCount: compConflicts.length,
      conflictCountByType,
      totalOverlapDays: round1(totalOverlapDays),
      criticalZoneIds,
      criticalZones: criticalZoneIds.map((id) => nodes.get(id)),
    });
  });

  // 按冲突数降序；并列时按集群内最小区域 ID 升序（稳定、确定性）
  clusters.sort((a, b) =>
    (b.conflictCount - a.conflictCount) ||
    (a.zoneIds[0] < b.zoneIds[0] ? -1 : a.zoneIds[0] > b.zoneIds[0] ? 1 : 0)
  );
  clusters.forEach((cl, i) => { cl.id = `cluster-${i + 1}`; });

  return clusters;
}

module.exports = { buildClusters, articulationPoints };
