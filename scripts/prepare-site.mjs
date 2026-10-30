import {mkdir,rm,cp,readdir,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const e of await readdir('dist')) await rm('dist/'+e,{recursive:true,force:true});
for(const f of ['index.html','MedLabPro.html','anibe.html','domec_site.html'])await cp(f,'dist/'+f);
await cp('Podcast','dist/Podcast',{recursive:true});
await import('../Merich/scripts/prepare.mjs').then(m=>m.prepareMerich('dist/Merich'));
await writeFile('dist/.nojekyll','');
