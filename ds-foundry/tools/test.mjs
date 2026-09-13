import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'dsf-tests-'));
try {
  await build({entryPoints:['tests/assets.test.ts'],bundle:true,platform:'node',format:'cjs',outfile:join(dir,'tests.cjs')});
  const r=spawnSync(process.execPath,['--test',join(dir,'tests.cjs')],{stdio:'inherit'});
  process.exitCode=r.status||0;
}finally{rmSync(dir,{recursive:true,force:true});}
