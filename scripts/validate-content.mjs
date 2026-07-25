/**
 * Content lint: validates every src/content/<name>.json against its
 * matching src/schemas/<name>.schema.json using Ajv.
 *
 * Exits 0 if the schemas directory is missing or empty — content and
 * schemas are authored separately and may not exist yet. Once a schema
 * exists, its content file must exist and validate.
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Ajv from 'ajv';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = path.resolve(root, '..');
const schemasDir = path.join(repo, 'src', 'schemas');
const contentDir = path.join(repo, 'src', 'content');

if (!existsSync(schemasDir)) {
  console.log('lint:content — no src/schemas directory yet; nothing to validate.');
  process.exit(0);
}

const schemaFiles = (await readdir(schemasDir)).filter((f) => f.endsWith('.schema.json'));

if (schemaFiles.length === 0) {
  console.log('lint:content — src/schemas is empty; nothing to validate.');
  process.exit(0);
}

const ajv = new Ajv({ allErrors: true, strict: false });
let failures = 0;

for (const schemaFile of schemaFiles.sort()) {
  const name = schemaFile.replace(/\.schema\.json$/, '');
  const contentFile = path.join(contentDir, `${name}.json`);
  const label = `src/content/${name}.json`;

  let schema;
  try {
    schema = JSON.parse(await readFile(path.join(schemasDir, schemaFile), 'utf8'));
  } catch (err) {
    console.error(`FAIL  src/schemas/${schemaFile} — unreadable schema: ${err.message}`);
    failures++;
    continue;
  }

  if (!existsSync(contentFile)) {
    console.error(`FAIL  ${label} — missing (schema ${schemaFile} exists)`);
    failures++;
    continue;
  }

  let data;
  try {
    data = JSON.parse(await readFile(contentFile, 'utf8'));
  } catch (err) {
    console.error(`FAIL  ${label} — invalid JSON: ${err.message}`);
    failures++;
    continue;
  }

  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    console.error(`FAIL  src/schemas/${schemaFile} — schema does not compile: ${err.message}`);
    failures++;
    continue;
  }

  if (validate(data)) {
    console.log(`ok    ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    for (const e of validate.errors ?? []) {
      console.error(`      ${e.instancePath || '/'} ${e.message}`);
    }
    failures++;
  }
}

if (failures > 0) {
  console.error(`\nlint:content — ${failures} file(s) failed validation.`);
  process.exit(1);
}
console.log(`\nlint:content — ${schemaFiles.length} file(s) validated clean.`);
