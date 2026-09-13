import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('dist', { recursive: true });
const result = await build({entryPoints:['ui/assets.js'],bundle:true,format:'iife',target:'es2020',write:false});
const script=result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
writeFileSync('dist/ui.html',readFileSync('ui/ui.html','utf8').replace('<!-- CANONICAL_SCRIPT -->','<script>'+script+'</script>'));
console.log('dist/ui.html updated');
