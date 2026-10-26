import {mkdir,cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function prepareMerich(destination){
 await mkdir(destination,{recursive:true});
 for(const file of ['index.html','terms.html','styles.css','app.js','menu.mjs','icons.mjs','assets'])await cp(root+file,destination+'/'+file,{recursive:true});
 console.log('Merich website prepared in '+destination+'/');
}
