import {mkdir,rm,cp,writeFile,readdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const entry of await readdir('dist'))await rm('dist/'+entry,{recursive:true,force:true});
for(const file of ['index.html','terms.html','admin.html','MedLabPro.html','anibe.html','domec_site.html','base.css','store.css','admin.css','shared.js','store.js','admin.js','support.js','support.css','assistant-core.mjs','admin-support.js','favicon.svg','assets'])await cp(file,'dist/'+file,{recursive:true});
await writeFile('dist/.nojekyll','');
await import('../Merich/scripts/prepare.mjs').then(m=>m.prepareMerich('dist/Merich'));
console.log('Virex static storefront prepared in dist/.');
