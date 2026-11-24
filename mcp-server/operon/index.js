import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stableId = (value) => hash(value).slice(0, 16);
const fold = (value) => value.normalize('NFKC').toLowerCase();
const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TYPES = new Set(['task', 'knowledge', 'decision', 'resource', 'agent', 'workflow', 'validation', 'output']);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const PROTECTED = new Set(['.obsidian', '.git', '.trash', 'node_modules']);

function object(value, name, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error(`${name} inválido`);
  }
}

function text(value, name, max, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) {
    throw new Error(`${name} inválido`);
  }
  return value.normalize('NFC');
}

function filename(value, name) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 120 ||
      value !== value.normalize('NFC') || /[<>:"/\\|?*\[\]#^\x00-\x1f\x7f]/u.test(value) ||
      /[. ]$/u.test(value) || value.trim() !== value ||
      value === '.' || value === '..' || reserved.test(value) ||
      /[<>:"/\\|?*\[\]#^\x00-\x1f\x7f]/u.test(value.normalize('NFKC')) ||
      /[. ]$/u.test(value.normalize('NFKC')) || reserved.test(value.normalize('NFKC')) ||
      PROTECTED.has(fold(value))) {
    throw new Error(`${name} não é um nome de arquivo seguro`);
  }
  return value;
}

export function validateOperon(plan) {
  object(plan, 'plano', ['slug', 'name', 'objective', 'summary', 'genes']);
  if (typeof plan.slug !== 'string' || !ID.test(plan.slug) || reserved.test(plan.slug)) {
    throw new Error('slug inválido');
  }
  const name = filename(plan.name, 'name');
  if (typeof plan.objective !== 'string' || typeof plan.summary !== 'string' ||
      !plan.objective.trim() || !plan.summary.trim()) throw new Error('objective e summary são obrigatórios');
  const objective = text(plan.objective, 'objective', 10000);
  const summary = text(plan.summary, 'summary', 10000);
  if (!Array.isArray(plan.genes) || plan.genes.length < 1 || plan.genes.length > 100) {
    throw new Error('genes deve conter entre 1 e 100 itens');
  }
  const names = new Set();
  const ids = new Set();
  const genes = plan.genes.map((gene) => {
    object(gene, 'gene', ['key', 'title', 'type', 'objective', 'depends_on', 'priority']);
    const nodeTitle = filename(gene.title, 'gene.title');
    const key = fold(nodeTitle);
    if (names.has(key)) throw new Error('títulos de arquivos colidem');
    names.add(key);
    if (typeof gene.key !== 'string' || !ID.test(gene.key) || reserved.test(gene.key) || ids.has(gene.key)) throw new Error('gene.key inválido ou duplicado');
    ids.add(gene.key);
    if (!TYPES.has(gene.type) || !PRIORITIES.has(gene.priority)) throw new Error('tipo ou prioridade inválido');
    if (typeof gene.objective !== 'string' || !gene.objective.trim()) throw new Error('gene.objective obrigatório');
    if (!Array.isArray(gene.depends_on) || gene.depends_on.some((dep) => typeof dep !== 'string' || !ID.test(dep)) ||
        new Set(gene.depends_on).size !== gene.depends_on.length) throw new Error('gene.depends_on inválido');
    return { key: gene.key, title: nodeTitle, type: gene.type, objective: text(gene.objective, 'gene.objective', 10000),
      depends_on: [...gene.depends_on], priority: gene.priority };
  });
  for (const gene of genes) {
    if (gene.depends_on.some((dep) => !ids.has(dep) || dep === gene.key)) throw new Error('dependência ausente ou reflexiva');
  }
  const byKey = new Map(genes.map((gene) => [gene.key, gene]));
  const visiting = new Set();
  const done = new Set();
  function visit(key) {
    if (visiting.has(key)) throw new Error('ciclo de dependências');
    if (done.has(key)) return;
    visiting.add(key);
    for (const dep of byKey.get(key).depends_on) visit(dep);
    visiting.delete(key);
    done.add(key);
  }
  for (const gene of genes) visit(gene.key);
  return { name, slug: plan.slug, objective, summary, genes };
}

const rootId = (slug) => stableId(`root\0${slug}`);
const canvasNodeId = (slug, id) => stableId(`node\0${slug}\0${id}`);
const edgeId = (slug, id) => stableId(`edge\0${slug}\0${id}`);
const dependencyEdgeId = (slug, from, to) => stableId(`dependency\0${slug}\0${from}\0${to}`);
const basePath = (slug) => `Operons/${slug}`;

export function renderCanvas(input, existing) {
  const plan = validateOperon(input);
  if (existing !== undefined) {
    if (!existing || typeof existing !== 'object' || Array.isArray(existing) ||
        !Array.isArray(existing.nodes) || !Array.isArray(existing.edges)) throw new Error('Canvas inválido');
    if (existing.nodes.some((n) => !n || typeof n !== 'object' || typeof n.id !== 'string' ||
        !Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.width) || n.width <= 0 ||
        !Number.isFinite(n.height) || n.height <= 0 || !['file', 'text', 'group', 'link'].includes(n.type)) ||
        existing.edges.some((e) => !e || typeof e !== 'object' || typeof e.id !== 'string')) throw new Error('Canvas inválido');
    for (const node of existing.nodes) {
      if (node.type === 'link') {
        let url;
        try {
          if (typeof node.url !== 'string' || node.url.length > 2048 || /[\u0000-\u0020\u007f]/u.test(node.url)) throw new Error();
          url = new URL(node.url);
        } catch { throw new Error('Link Canvas inválido'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Link Canvas inválido');
      }
      if (node.type === 'file' || node.file !== undefined) {
        if (typeof node.file !== 'string' || !node.file.startsWith(`${basePath(plan.slug)}/`) ||
            !/\.(md|json|canvas)$/.test(node.file)) throw new Error('Caminho Canvas inválido');
        const parts = node.file.split('/');
        for (const part of parts) filename(part, 'caminho Canvas');
      }
    }
    if (new Set(existing.nodes.map((n) => n.id)).size !== existing.nodes.length ||
        new Set(existing.edges.map((e) => e.id)).size !== existing.edges.length) throw new Error('IDs duplicados no Canvas');
  }
  let previous = existing ?? { nodes: [], edges: [] };
  if (previous.operon !== undefined) {
    const meta = previous.operon;
    if (!meta || meta.slug !== plan.slug || !Array.isArray(meta.genes) ||
        meta.genes.some((gene) => !gene || typeof gene.key !== 'string' || !ID.test(gene.key) ||
          !Array.isArray(gene.depends_on) || gene.depends_on.some((dep) => typeof dep !== 'string' || !ID.test(dep)))) {
      throw new Error('Metadados Canvas inválidos');
    }
    const next = new Set(plan.genes.map((gene) => gene.key));
    const removedNodes = new Set(meta.genes.filter((gene) => !next.has(gene.key)).map((gene) => canvasNodeId(plan.slug, gene.key)));
    const nextDependencies = new Set(plan.genes.flatMap((gene) => gene.depends_on.map((dep) => dependencyEdgeId(plan.slug, dep, gene.key))));
    const removedEdges = new Set(meta.genes.flatMap((gene) => [
      ...(!next.has(gene.key) ? [edgeId(plan.slug, gene.key)] : []),
      ...gene.depends_on.map((dep) => dependencyEdgeId(plan.slug, dep, gene.key)).filter((id) => !nextDependencies.has(id)),
    ]));
    if (previous.edges.some((edge) => (removedNodes.has(edge.fromNode) || removedNodes.has(edge.toNode)) && !removedEdges.has(edge.id))) {
      throw new Error('Gene removido possui aresta personalizada');
    }
    previous = { ...previous, nodes: previous.nodes.filter((node) => !removedNodes.has(node.id)),
      edges: previous.edges.filter((edge) => !removedEdges.has(edge.id)) };
  }
  const previousIds = new Set(previous.nodes.map((node) => node.id));
  if (previous.edges.some((edge) => !previousIds.has(edge.fromNode) || !previousIds.has(edge.toNode))) throw new Error('Aresta Canvas inválida');
  const byId = new Map(previous.nodes.map((n) => [n.id, n]));
  const root = rootId(plan.slug);
  const specs = [{ id: root, file: `${basePath(plan.slug)}/Promotor.md`, x: 0, y: 0 }];
  const radius = plan.genes.length > 1 ? Math.max(500, Math.ceil(380 / (2 * Math.sin(Math.PI / plan.genes.length)))) : 500;
  plan.genes.forEach((node, index) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / plan.genes.length;
    specs.push({ id: canvasNodeId(plan.slug, node.key), file: `${basePath(plan.slug)}/Genes/${node.title}.md`,
      x: Math.round(radius * Math.cos(angle)), y: Math.round(radius * Math.sin(angle)) });
  });
  const managed = specs.map((spec) => {
    const old = byId.get(spec.id);
    return { ...old, id: spec.id, type: 'file', file: spec.file,
      x: Number.isFinite(old?.x) ? old.x : spec.x, y: Number.isFinite(old?.y) ? old.y : spec.y,
      width: Number.isFinite(old?.width) ? old.width : 300, height: Number.isFinite(old?.height) ? old.height : 180 };
  });
  const managedIds = new Set(specs.map((n) => n.id));
  const edges = plan.genes.flatMap((node) => {
    const id = edgeId(plan.slug, node.key);
    return [
      { ...previous.edges.find((e) => e.id === id), id, fromNode: root, toNode: canvasNodeId(plan.slug, node.key) },
      ...node.depends_on.map((dep) => {
        const depId = dependencyEdgeId(plan.slug, dep, node.key);
        return { ...previous.edges.find((e) => e.id === depId), id: depId,
          fromNode: canvasNodeId(plan.slug, dep), toNode: canvasNodeId(plan.slug, node.key) };
      }),
    ];
  });
  const managedEdgeIds = new Set(edges.map((e) => e.id));
  return { ...previous, operon: { slug: plan.slug, genes: plan.genes.map((gene) => ({ key: gene.key, depends_on: gene.depends_on })) },
    nodes: [...managed, ...previous.nodes.filter((n) => !managedIds.has(n.id))],
    edges: [...edges, ...previous.edges.filter((e) => !managedEdgeIds.has(e.id))] };
}

function vaultPath() {
  const vault = process.env.MESTRE_OBSIDIAN_VAULT;
  if (!vault || !path.isAbsolute(vault)) throw new Error('MESTRE_OBSIDIAN_VAULT deve indicar um diretório absoluto existente');
  const resolved = path.resolve(vault);
  checkPath(resolved, false, true);
  return resolved;
}

// lstat every component, including ancestors of the configured vault.
function checkPath(target, allowMissing = false, directory = false) {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) return false;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('Links simbólicos ou junctions não são permitidos');
    if ((i < parts.length - 1 || directory) && !stat.isDirectory()) throw new Error('Diretório inválido');
    if (i === parts.length - 1 && !directory && !stat.isFile()) throw new Error('Arquivo inválido');
  }
  return true;
}

function safeRead(file) {
  if (!checkPath(file, true)) return null;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('Arquivo inválido');
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

function readManifest(dir) {
  const raw = safeRead(path.join(dir, 'Manifest.json'));
  if (raw === null) return null;
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Manifest inválido'); }
  object(value, 'manifest', ['version', 'plan', 'files']);
  if (value.version !== 1 || !value.files || typeof value.files !== 'object' || Array.isArray(value.files)) throw new Error('Manifest inválido');
  const plan = validateOperon(value.plan);
  const expected = ['Promotor.md', ...plan.genes.map((n) => `Genes/${n.title}.md`)];
  if (Object.keys(value.files).length !== expected.length ||
      expected.some((name) => !Object.hasOwn(value.files, name) || !/^[a-f0-9]{64}$/.test(value.files[name]))) throw new Error('Manifest inválido');
  return { plan, files: value.files };
}

function markdown(plan) {
  const yaml = JSON.stringify;
  return new Map([
    ['Promotor.md', `---\nname: ${yaml(plan.name)}\nslug: ${yaml(plan.slug)}\nobjective: ${yaml(plan.objective)}\nsummary: ${yaml(plan.summary)}\n---\n\n# ${plan.name}\n\n## Objetivo\n\n${plan.objective}\n\n## Resumo\n\n${plan.summary}\n\n## Genes\n\n${plan.genes.map((gene) => `- [[${basePath(plan.slug)}/Genes/${gene.title}|${gene.title}]]`).join('\n')}\n`],
    ...plan.genes.map((gene) => [`Genes/${gene.title}.md`, `---\nkey: ${yaml(gene.key)}\ntitle: ${yaml(gene.title)}\ntype: ${yaml(gene.type)}\nobjective: ${yaml(gene.objective)}\ndepends_on: ${yaml(gene.depends_on)}\npriority: ${yaml(gene.priority)}\n---\n\n# ${gene.title}\n\n${gene.objective}\n\n## Dependências\n\n${gene.depends_on.map((dep) => {
      const target = plan.genes.find((candidate) => candidate.key === dep);
      return `- [[${basePath(plan.slug)}/Genes/${target.title}|${target.title}]]`;
    }).join('\n') || 'Nenhuma.'}\n\n[[${basePath(plan.slug)}/Promotor|Promotor]]\n`]),
  ]);
}

function checkTree(dir) {
  if (!checkPath(dir, true, true)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (PROTECTED.has(fold(entry.name))) throw new Error('Diretório protegido proibido');
    const stat = fs.lstatSync(child);
    if (stat.isSymbolicLink()) throw new Error('Links simbólicos ou junctions não são permitidos');
    if (stat.isDirectory()) checkTree(child);
    else if (!stat.isFile() || !/\.(md|json|canvas)$/i.test(entry.name)) throw new Error('Extensão não permitida na árvore');
  }
}

function ensureDirectory(dir) {
  if (!checkPath(dir, true, true)) {
    checkPath(path.dirname(dir), false, true);
    let created = false;
    try { fs.mkdirSync(dir); created = true; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    checkPath(dir, false, true);
    return created;
  }
  return false;
}

function writeExclusive(file, content) {
  checkPath(path.dirname(file), false, true);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    try { fs.unlinkSync(file); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { fs.closeSync(fd); }
}

function prepare(plan, vault) {
  const dir = path.join(vault, 'Operons', plan.slug);
  checkPath(dir, true, true);
  checkTree(dir);
  const prior = readManifest(dir);
  if (prior && prior.plan.slug !== plan.slug) throw new Error('Manifest pertence a outro Operon');
  const contents = markdown(plan);
  const oldNames = prior ? Object.keys(prior.files) : [];
  for (const name of oldNames) {
    const current = safeRead(path.join(dir, name));
    if (current === null || hash(current) !== prior.files[name]) throw new Error(`Arquivo gerado modificado ou ausente: ${name}`);
  }
  for (const name of contents.keys()) {
    const current = safeRead(path.join(dir, name));
    if (current !== null && !oldNames.includes(name)) {
      const equivalent = oldNames.find((old) => fold(old) === fold(name));
      const existingStat = fs.statSync(path.join(dir, name));
      const oldStat = equivalent ? fs.statSync(path.join(dir, equivalent)) : null;
      if (!oldStat || existingStat.ino !== oldStat.ino || existingStat.dev !== oldStat.dev) {
        throw new Error(`Arquivo existente não pertence ao Operon: ${name}`);
      }
    }
  }
  const canvasRaw = safeRead(path.join(dir, 'Operon.canvas'));
  if (!prior && canvasRaw !== null) throw new Error('Canvas existente não pertence ao Operon');
  let existing;
  if (canvasRaw !== null) {
    try { existing = JSON.parse(canvasRaw); } catch { throw new Error('Canvas inválido'); }
  } else if (prior) throw new Error('Canvas gerado ausente');
  // Remove only previously managed nodes that were removed from the plan.
  if (existing && prior) {
    const next = new Set(plan.genes.map((node) => node.key));
    const removed = prior.plan.genes.filter((node) => !next.has(node.key));
    const removedNodes = new Set(removed.map((node) => canvasNodeId(plan.slug, node.key)));
    const currentEdges = new Set(plan.genes.flatMap((gene) => gene.depends_on.map((dep) => dependencyEdgeId(plan.slug, dep, gene.key))));
    const removedEdges = new Set(prior.plan.genes.flatMap((gene) => [
      ...(!next.has(gene.key) ? [edgeId(plan.slug, gene.key)] : []),
      ...gene.depends_on.map((dep) => dependencyEdgeId(plan.slug, dep, gene.key)).filter((id) => !currentEdges.has(id)),
    ]));
    if (Array.isArray(existing.edges) && existing.edges.some((edge) =>
      (removedNodes.has(edge?.fromNode) || removedNodes.has(edge?.toNode)) && !removedEdges.has(edge.id))) {
      throw new Error('Gene removido possui aresta personalizada');
    }
    if (Array.isArray(existing.nodes)) existing.nodes = existing.nodes.filter((node) => !removedNodes.has(node?.id));
    if (Array.isArray(existing.edges)) existing.edges = existing.edges.filter((edge) => !removedEdges.has(edge?.id));
  }
  contents.set('Operon.canvas', `${JSON.stringify(renderCanvas(plan, existing), null, 2)}\n`);
  const files = Object.fromEntries([...contents].filter(([name]) => name.endsWith('.md')).map(([name, value]) => [name, hash(value)]));
  contents.set('Manifest.json', `${JSON.stringify({ version: 1, plan, files }, null, 2)}\n`);
  const deletes = oldNames.filter((name) => !contents.has(name));
  const diff = { created: [], updated: [], removed: [], unchanged: [] };
  for (const [name, content] of contents) {
    const current = safeRead(path.join(dir, name));
    const kind = current === null ? 'created' : current === content ? 'unchanged' : 'updated';
    diff[kind].push(`${basePath(plan.slug)}/${name}`);
  }
  diff.removed = deletes.map((name) => `${basePath(plan.slug)}/${name}`);
  return { dir, contents, deletes, diff };
}

export function createOperon(input, { dryRun = false } = {}) {
  if (typeof dryRun !== 'boolean') throw new Error('dryRun inválido');
  const plan = validateOperon(input);
  const vault = vaultPath();
  const preview = () => {
    const prepared = prepare(plan, vault);
    return { ...prepared, result: { slug: plan.slug, dryRun, files: [...prepared.contents.keys()].map((name) => `${basePath(plan.slug)}/${name}`), diff: prepared.diff } };
  };
  if (dryRun) return preview().result;
  const parent = path.join(vault, 'Operons');
  const createdDirs = [];
  if (ensureDirectory(parent)) createdDirs.push(parent);
  const lock = path.join(parent, `.${plan.slug}.lock.json`);
  try { writeExclusive(lock, `${process.pid}\n`); } catch (error) {
    for (const created of createdDirs.reverse()) {
      try { fs.rmdirSync(created); } catch { /* Não remover diretórios ocupados. */ }
    }
    if (error.code === 'EEXIST') throw new Error('Operon está em uso');
    throw error;
  }
  let success = false;
  let finalResult;
  let failure;
  try {
    const { dir, contents, deletes, result } = preview();
    if (ensureDirectory(dir)) createdDirs.push(dir);
    if (ensureDirectory(path.join(dir, 'Genes'))) createdDirs.push(path.join(dir, 'Genes'));
    const token = crypto.randomBytes(16).toString('hex');
    const stages = new Map();
    const backups = new Map();
    const installed = [];
    let rollbackIncomplete = false;
    try {
      for (const [name, content] of contents) {
        const stage = path.join(dir, `.operon-${token}-${stages.size}.stage.json`);
        writeExclusive(stage, content);
        stages.set(name, stage);
      }
      for (const name of [...new Set([...deletes, ...contents.keys()])]) {
        const target = path.join(dir, name);
        if (checkPath(target, true)) {
          const backup = path.join(dir, `.operon-${token}-${backups.size}.backup.json`);
          if (checkPath(backup, true)) throw new Error('Backup já existe');
          fs.renameSync(target, backup);
          backups.set(target, backup);
        }
      }
      for (const name of contents.keys()) {
        const target = path.join(dir, name);
        checkPath(path.dirname(target), false, true);
        if (checkPath(target, true)) throw new Error('Destino já existe');
        checkPath(stages.get(name), false);
        fs.renameSync(stages.get(name), target);
        installed.push(target);
      }
    } catch (error) {
      const failures = [];
      for (const target of installed.reverse()) {
        try { if (checkPath(target, true)) fs.unlinkSync(target); } catch (e) { failures.push(e.message); }
      }
      for (const [target, backup] of [...backups].reverse()) {
        try {
          checkPath(backup, false);
          if (checkPath(target, true)) throw new Error('Destino ocupado durante rollback');
          fs.renameSync(backup, target);
        } catch (e) { failures.push(e.message); }
      }
      if (failures.length) {
        rollbackIncomplete = true;
        throw new Error(`Falha no rollback; backups preservados e estado incompleto: ${failures.join('; ')}`, { cause: error });
      }
      throw error;
    } finally {
      if (!rollbackIncomplete) {
        for (const stage of stages.values()) {
          if (checkPath(stage, true)) fs.unlinkSync(stage);
        }
      }
    }
    success = true;
    finalResult = result;
    for (const backup of backups.values()) {
      try {
        if (checkPath(backup, true)) fs.unlinkSync(backup);
      } catch {
        (result.warnings ??= []).push(`Backup não removido: ${path.basename(backup)}`);
      }
    }
    return result;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (checkPath(lock, true)) fs.unlinkSync(lock);
    } catch (error) {
      if (success) (finalResult.warnings ??= []).push(`Lock não removido: ${path.basename(lock)}`);
      else if (failure) failure.message += '; lock não removido';
      else throw error;
    }
    if (!success) {
      for (const created of createdDirs.reverse()) {
        try { checkPath(created, false, true); fs.rmdirSync(created); } catch { /* Preservar dados ocupados. */ }
      }
    }
  }
}

export function getOperon(slug) {
  if (typeof slug !== 'string' || !ID.test(slug) || reserved.test(slug)) throw new Error('slug inválido');
  const vault = vaultPath();
  const dir = path.join(vault, 'Operons', slug);
  checkTree(dir);
  const manifest = readManifest(dir);
  if (!manifest) return null;
  if (manifest.plan.slug !== slug) throw new Error('Manifest pertence a outro Operon');
  return manifest.plan;
}

export function listOperons() {
  const vault = vaultPath();
  const root = path.join(vault, 'Operons');
  if (!checkPath(root, true, true)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => {
      if (!ID.test(entry.name) || reserved.test(entry.name)) throw new Error('Diretório Operon inválido');
      checkPath(path.join(root, entry.name), false, true);
      const plan = getOperon(entry.name);
      if (!plan) throw new Error('Manifest ausente');
      return plan;
    })
    .sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
}
