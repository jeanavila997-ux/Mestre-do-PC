import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOperon, createOperon, getOperon, listOperons, renderCanvas } from '../operon/index.js';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), `.operon-domain-fixture-${process.pid}`);
const previousVault = process.env.MESTRE_OBSIDIAN_VAULT;
fs.mkdirSync(fixture, { recursive: false });
process.env.MESTRE_OBSIDIAN_VAULT = fixture;
after(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
  if (previousVault === undefined) delete process.env.MESTRE_OBSIDIAN_VAULT;
  else process.env.MESTRE_OBSIDIAN_VAULT = previousVault;
});

const plan = () => ({
  name: 'Plano seguro', slug: 'plano-seguro', objective: 'Construir', summary: 'Resumo',
  genes: [
    { key: 'primeiro', title: 'Primeiro', type: 'task', objective: 'Iniciar', depends_on: [], priority: 'high' },
    { key: 'segundo', title: 'Segundo', type: 'validation', objective: 'Verificar', depends_on: ['primeiro'], priority: 'medium' },
  ],
});
const dir = () => path.join(fixture, 'Operons', 'plano-seguro');
const read = (file) => fs.readFileSync(path.join(dir(), file), 'utf8');

test('schema estrito, nomes portáveis e grafo acíclico', () => {
  assert.deepEqual(validateOperon(plan()), plan());
  for (const bad of ['../foo', 'CON', 'NUL.txt', 'x.', 'x ', 'a:b', '.git', 'ｅ／x', 'e\u0301', 'A[foo]']) {
    const p = plan(); p.genes[0].title = bad;
    assert.throws(() => validateOperon(p), bad);
  }
  for (const change of [
    (p) => { p.extra = true; },
    (p) => { p.genes[0].extra = true; },
    (p) => { p.genes[0].key = p.genes[1].key; },
    (p) => { p.genes[0].title = 'Ｓegundo'; },
    (p) => { p.genes[0].type = 'unknown'; },
    (p) => { p.genes[0].priority = 'unknown'; },
    (p) => { p.genes[0].depends_on = ['inexistente']; },
    (p) => { p.genes[0].depends_on = ['primeiro']; },
    (p) => { p.genes[0].depends_on = ['segundo']; },
    (p) => { delete p.summary; },
    (p) => { p.slug = '../x'; },
  ]) {
    const p = plan(); change(p); assert.throws(() => validateOperon(p));
  }
});

test('dry-run não cria arquivos; criação, YAML, links, manifesto e busca', () => {
  const preview = createOperon(plan(), { dryRun: true });
  assert.equal(preview.dryRun, true);
  assert.equal(preview.diff.created.length, 5);
  assert.equal(fs.existsSync(path.join(fixture, 'Operons')), false);
  const result = createOperon(plan());
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.files, preview.files);
  assert.match(read('Promotor.md'), /^---\nname: "Plano seguro"/);
  assert.match(read('Promotor.md'), /\[\[Operons\/plano-seguro\/Genes\/Primeiro\|Primeiro\]\]/);
  assert.match(read('Genes/Segundo.md'), /\[\[Operons\/plano-seguro\/Genes\/Primeiro\|Primeiro\]\]/);
  assert.deepEqual(getOperon('plano-seguro'), plan());
  assert.deepEqual(listOperons(), [plan()]);
  assert.equal(getOperon('inexistente'), null);
});

test('canvas radial determinístico com dependências e dimensões preservadas', () => {
  const canvas = JSON.parse(read('Operon.canvas'));
  assert.equal(canvas.nodes.length, 3);
  assert.equal(canvas.edges.length, 3);
  const nodes = new Set(canvas.nodes.map((n) => n.id));
  for (const edge of canvas.edges) assert.ok(nodes.has(edge.fromNode) && nodes.has(edge.toNode));
  canvas.nodes[1].x = 123; canvas.nodes[1].y = -9;
  canvas.nodes[1].width = 345; canvas.nodes[1].height = 222;
  canvas.nodes.push({ id: 'custom', type: 'text', text: 'Nota', x: 2, y: 3, width: 100, height: 100 });
  canvas.nodes.push({ id: 'external', type: 'link', url: 'https://example.org/ref', x: 5, y: 6, width: 100, height: 100 });
  canvas.edges.push({ id: 'custom-edge', fromNode: 'custom', toNode: canvas.nodes[0].id });
  const rerender = renderCanvas(plan(), canvas);
  assert.deepEqual([rerender.nodes[1].x, rerender.nodes[1].y, rerender.nodes[1].width, rerender.nodes[1].height], [123, -9, 345, 222]);
  assert.ok(rerender.nodes.find((n) => n.id === 'custom'));
  assert.equal(rerender.nodes.find((n) => n.id === 'external').url, 'https://example.org/ref');
  fs.writeFileSync(path.join(dir(), 'Operon.canvas'), JSON.stringify(canvas));
  createOperon(plan());
  assert.deepEqual(JSON.parse(read('Operon.canvas')), rerender);
  assert.deepEqual(renderCanvas(plan()), renderCanvas(plan()));
  const fewer = plan(); fewer.genes.pop();
  const pruned = renderCanvas(fewer, renderCanvas(plan()));
  assert.equal(pruned.nodes.length, 2);
  assert.equal(pruned.edges.length, 1);
  const many = plan(); many.genes = Array.from({ length: 100 }, (_, i) =>
    ({ key: `gene-${i}`, title: `Gene ${i}`, type: 'task', objective: 'Objetivo', depends_on: [], priority: 'low' }));
  const radial = renderCanvas(many);
  assert.ok(Math.hypot(radial.nodes[1].x - radial.nodes[2].x, radial.nodes[1].y - radial.nodes[2].y) >= 379);
});

test('respeita arquivos alheios e impede sobrescrever markdown editado', () => {
  const extra = path.join(dir(), 'Genes', 'Alheio.md');
  fs.writeFileSync(extra, 'meu arquivo');
  const p = plan(); p.genes[0].title = 'Alheio';
  assert.throws(() => createOperon(p), /não pertence/);
  assert.equal(fs.readFileSync(extra, 'utf8'), 'meu arquivo');
  const target = path.join(dir(), 'Genes', 'Primeiro.md');
  const original = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, 'edição manual');
  assert.throws(() => createOperon(plan()), /modificado/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'edição manual');
  fs.writeFileSync(target, original);
});

test('rollback recupera arquivos após falha durante instalação', (t) => {
  const before = new Map(['Promotor.md', 'Genes/Primeiro.md', 'Genes/Segundo.md', 'Manifest.json', 'Operon.canvas'].map((f) => [f, read(f)]));
  const original = fs.renameSync;
  let failed = false;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (!failed && args[0].includes('.stage.json') && args[1].endsWith('Segundo.md')) {
      failed = true; throw new Error('falha simulada');
    }
    return original(...args);
  });
  const changed = plan(); changed.summary = 'Novo resumo';
  assert.throws(() => createOperon(changed), /falha simulada/);
  assert.equal(failed, true);
  for (const [file, contents] of before) assert.equal(read(file), contents);
  assert.ok(!fs.readdirSync(dir()).some((file) => file.includes('.stage.') || file.includes('.backup.')));
});

test('rejeita symlinks na árvore, em destinos e ancestrais, e lock concorrente', (t) => {
  const link = path.join(dir(), 'atalho');
  try { fs.symlinkSync(fixture, link, 'dir'); } catch (error) {
    if (error.code === 'EPERM') return t.skip('symlink indisponível');
    throw error;
  }
  assert.throws(() => createOperon(plan(), { dryRun: true }), /simbólicos/);
  assert.throws(() => getOperon('plano-seguro'), /simbólicos/);
  fs.unlinkSync(link);
  const target = path.join(dir(), 'Genes', 'Primeiro.md');
  const original = fs.readFileSync(target, 'utf8');
  fs.unlinkSync(target);
  fs.symlinkSync(path.join(dir(), 'Genes', 'Segundo.md'), target, 'file');
  assert.throws(() => createOperon(plan()), /simbólicos/);
  fs.unlinkSync(target);
  fs.writeFileSync(target, original);
  const vaultLink = path.join(fixture, 'vault-link');
  fs.symlinkSync(fixture, vaultLink, 'dir');
  process.env.MESTRE_OBSIDIAN_VAULT = vaultLink;
  assert.throws(() => listOperons(), /simbólicos/);
  process.env.MESTRE_OBSIDIAN_VAULT = fixture;
  fs.unlinkSync(vaultLink);
  const lock = path.join(fixture, 'Operons', '.plano-seguro.lock.json');
  fs.writeFileSync(lock, 'outro');
  assert.throws(() => createOperon(plan()), /em uso/);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'outro');
  fs.unlinkSync(lock);
});

test('vault ausente não é criado', () => {
  process.env.MESTRE_OBSIDIAN_VAULT = path.join(fixture, 'ausente');
  assert.throws(() => createOperon(plan()));
  assert.equal(fs.existsSync(process.env.MESTRE_OBSIDIAN_VAULT), false);
  process.env.MESTRE_OBSIDIAN_VAULT = fixture;
});

test('impede Canvas externo, dimensões inválidas, diretórios protegidos e extensões não permitidas', () => {
  const canvas = JSON.parse(read('Operon.canvas'));
  const changed = structuredClone(canvas);
  changed.nodes[0].file = '../segredo.md';
  assert.throws(() => renderCanvas(plan(), changed), /Caminho/);
  changed.nodes[0].file = 'Operons/plano-seguro/.git/config.md';
  assert.throws(() => renderCanvas(plan(), changed));
  changed.nodes[0].file = canvas.nodes[0].file;
  changed.nodes[0].width = 0;
  assert.throws(() => renderCanvas(plan(), changed), /Canvas inválido/);
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', `https://${'usuario'}:${'senha'}@example.org/`, 'https://example.org/\n']) {
    const unsafe = structuredClone(canvas);
    unsafe.nodes.push({ id: 'unsafe', type: 'link', url, x: 0, y: 0, width: 1, height: 1 });
    assert.throws(() => renderCanvas(plan(), unsafe), /Link Canvas inválido/);
  }
  const unsafeFile = structuredClone(canvas);
  unsafeFile.nodes.push({ id: 'unsafe', type: 'link', url: 'https://example.org/', file: '../fora.md', x: 0, y: 0, width: 1, height: 1 });
  assert.throws(() => renderCanvas(plan(), unsafeFile), /Caminho Canvas inválido/);
  const nested = path.join(dir(), 'Dados');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'invalido.exe'), '');
  assert.throws(() => createOperon(plan(), { dryRun: true }), /Extensão/);
  fs.unlinkSync(path.join(nested, 'invalido.exe'));
  fs.mkdirSync(path.join(nested, '.git'));
  assert.throws(() => createOperon(plan(), { dryRun: true }), /protegido/);
  fs.rmSync(nested, { recursive: true });
});

test('falha inicial restaura ausência do diretório criado', (t) => {
  const p = plan(); p.slug = 'falha-nova';
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (args[0].includes('.stage.json')) throw new Error('falha inicial');
    return original(...args);
  });
  assert.throws(() => createOperon(p), /falha inicial/);
  assert.equal(fs.existsSync(path.join(fixture, 'Operons', p.slug)), false);
});

test('avisa se limpeza de backup falha depois do commit', (t) => {
  const original = fs.unlinkSync;
  t.mock.method(fs, 'unlinkSync', (file, ...args) => {
    if (String(file).endsWith('.backup.json')) throw new Error('falha na limpeza');
    return original(file, ...args);
  });
  const result = createOperon(plan());
  assert.ok(result.warnings?.some((warning) => warning.includes('Backup')));
  assert.deepEqual(getOperon('plano-seguro'), plan());
});

test('rollback incompleto preserva backups recuperáveis', (t) => {
  const original = fs.renameSync;
  let failed = false;
  t.mock.method(fs, 'renameSync', (...args) => {
    if (!failed && args[0].includes('.stage.json') && args[1].endsWith('Segundo.md')) {
      failed = true; throw new Error('falha inicial');
    }
    if (failed && args[0].includes('.backup.json')) throw new Error('sem permissão');
    return original(...args);
  });
  const changed = plan(); changed.summary = 'Alteração';
  assert.throws(() => createOperon(changed), /backups preservados e estado incompleto/);
  assert.ok(fs.readdirSync(dir()).some((file) => file.endsWith('.backup.json')));
});
