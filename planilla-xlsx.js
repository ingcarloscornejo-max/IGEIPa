/* GEI Panamá: lectura local de plantillas XLSX. JSZip 3.10.1 y sax 1.6.1. */
(function (global) {
'use strict';
const MAX_FILE=10*1024*1024,MAX_EXPANDED=25*1024*1024,MAX_XML=4*1024*1024;
function checkArchive(buffer){
 if(buffer.byteLength>MAX_FILE)throw Error('La planilla supera 10 MB.');
 const v=new DataView(buffer);let end=-1;
 for(let i=buffer.byteLength-22;i>=Math.max(0,buffer.byteLength-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)throw Error('No es un archivo XLSX válido.');
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);if(count>2000||count===65535)throw Error('La planilla tiene demasiados archivos internos.');
 let pos=start,total=0;
 for(let i=0;i<count;i++){
  if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)throw Error('La estructura del Excel está incompleta.');
  if(v.getUint16(pos+8,true)&1)throw Error('Guarda una copia de Excel sin contraseña.');
  const size=v.getUint32(pos+24,true);total+=size;if(size>MAX_XML||total>MAX_EXPANDED)throw Error('La planilla es demasiado grande para esta carga.');
  pos+=46+v.getUint16(pos+28,true)+v.getUint16(pos+30,true)+v.getUint16(pos+32,true);
 }
}
async function boundedText(entry){
 if(!entry)throw Error('Falta un componente del archivo Excel.');
 return new Promise((resolve,reject)=>{
  let size=0,done=false;const chunks=[],stream=entry.internalStream('uint8array');
  stream.on('data',chunk=>{if(done)return;size+=chunk.length;if(size>MAX_XML){done=true;stream.pause();reject(Error('Una hoja supera el tamaño permitido.'));return;}chunks.push(chunk);});
  stream.on('error',err=>{if(!done){done=true;reject(err);}});
  stream.on('end',()=>{if(done)return;done=true;try{const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}resolve(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(err){reject(Error('El Excel contiene texto no válido. Guarda una copia nueva desde Excel.'));}});stream.resume();
 });
}
function xmlTree(text){
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('La planilla contiene una definición XML no admitida.');
 const parser=global.sax.parser(true),stack=[];let root=null,nodes=0;
 parser.onopentag=t=>{if(stack.length>40)throw Error('La planilla tiene una estructura XML demasiado profunda.');if(++nodes>50000)throw Error('La hoja contiene demasiados elementos.');const n={name:t.name.split(':').pop(),attrs:t.attributes,children:[],text:''};if(stack.length)stack[stack.length-1].children.push(n);else root=n;stack.push(n);};
 parser.ontext=t=>{if(stack.length)stack[stack.length-1].text+=t;};parser.oncdata=parser.ontext;
 parser.onclosetag=()=>stack.pop();parser.onerror=e=>{throw e;};parser.write(text).close();if(!root)throw Error('Hoja XML vacía.');return root;
}
const children=(node,name)=>(node?.children||[]).filter(n=>n.name===name);
const first=(node,name)=>children(node,name)[0];
function descendants(node,name){const out=[];for(const child of node?.children||[]){if(child.name===name)out.push(child);out.push(...descendants(child,name));}return out;}
function textValue(node){return node?(node.text||'')+(node.children||[]).map(textValue).join(''):'';}
function attr(node,key){const attrs=node?.attrs||{};return attrs[key]??Object.entries(attrs).find(([k])=>k.split(':').pop()===key)?.[1];}
function pathFor(target){if(/^[a-z]+:/i.test(target))throw Error('No se admiten referencias externas de Excel.');const raw=target.startsWith('/')?target.slice(1):'xl/'+target,out=[];for(const part of raw.split('/')){if(part==='..'){if(!out.length)throw Error('Ruta interna de Excel inválida.');out.pop();}else if(part&&part!=='.')out.push(part);}return out.join('/');}
function sheetRows(tree,shared,percentageStyles){
 const data=first(tree,'sheetData');if(!data)throw Error('La hoja no contiene datos.');const rows=[];let cells=0;
 for(const r of children(data,'row')){const index=Number(attr(r,'r'));if(!Number.isInteger(index)||index<1||index>1000)throw Error('La plantilla admite hasta 1000 filas por hoja.');const row={number:index,cells:[]};
  for(const c of children(r,'c')){if(++cells>10000)throw Error('La hoja contiene demasiadas celdas.');const ref=String(attr(c,'r')||''),match=/^([A-Z]+)(\d+)$/.exec(ref);if(!match)throw Error('Referencia de celda inválida.');let col=0;for(const ch of match[1])col=col*26+ch.charCodeAt(0)-64;if(col>50)throw Error('La hoja tiene columnas fuera de la plantilla.');
   if(first(c,'f'))throw Error('La planilla debe contener valores, no fórmulas. Copia y pega como valores antes de subirla.');
   const type=attr(c,'t'),raw=textValue(first(c,'v'));let value='';
   if(type==='s'){const n=Number(raw);if(!Number.isInteger(n)||n<0||n>=shared.length)throw Error('Texto compartido de Excel no válido.');value=shared[n];}
   else if(type==='inlineStr')value=descendants(first(c,'is'),'t').map(textValue).join('');
   else if(type==='e')throw Error('La celda '+ref+' contiene un error de Excel.');
   else if(type==='b')value=raw==='1';else if(type==='str'||type==='d')value=raw;else if(raw!==''){value=Number(raw);if(!Number.isFinite(value))throw Error('La celda '+ref+' no contiene un número válido.');}
   if(typeof value==='string'&&value.length>5000)throw Error('El texto de la celda '+ref+' es demasiado largo.');
   if(row.cells[col-1]!==undefined)throw Error('Celda repetida en la hoja: '+ref);row.cells[col-1]={value,percent:percentageStyles.has(Number(attr(c,'s')||0)),ref};
  }rows.push(row);
 }return rows;
}
async function read(buffer){
 if(!global.JSZip||!global.sax)throw Error('No se cargó el lector de Excel. Recarga la app y vuelve a intentarlo.');checkArchive(buffer);
 const zip=await global.JSZip.loadAsync(buffer,{checkCRC32:false});if(Object.keys(zip.files).some(n=>/vbaProject|encryptedPackage/i.test(n)))throw Error('La plantilla debe ser XLSX sin macros.');
 const book=xmlTree(await boundedText(zip.file('xl/workbook.xml'))),rels=xmlTree(await boundedText(zip.file('xl/_rels/workbook.xml.rels')));
 const targets=new Map(children(rels,'Relationship').filter(n=>attr(n,'TargetMode')!=='External').map(n=>[attr(n,'Id'),attr(n,'Target')]));
 const shared=zip.file('xl/sharedStrings.xml')?children(xmlTree(await boundedText(zip.file('xl/sharedStrings.xml'))),'si').map(n=>descendants(n,'t').map(textValue).join('')):[];
 const percentageStyles=new Set();
 if(zip.file('xl/styles.xml')){const styles=xmlTree(await boundedText(zip.file('xl/styles.xml'))),formats=new Map(children(first(styles,'numFmts'),'numFmt').map(n=>[Number(attr(n,'numFmtId')),String(attr(n,'formatCode')||'')]));children(first(styles,'cellXfs'),'xf').forEach((n,i)=>{const id=Number(attr(n,'numFmtId')),f=(formats.get(id)||'').replace(/"[^"]*"|\\./g,'');if(id===9||id===10||f.includes('%'))percentageStyles.add(i);});}
 const result={date1904:['1','true'].includes(String(attr(first(book,'workbookPr'),'date1904'))),sheets:Object.create(null)};
 for(const sheet of children(first(book,'sheets'),'sheet')){const name=attr(sheet,'name');if(!['Datos','Fertilizantes'].includes(name))continue;if(result.sheets[name])throw Error('Hay una hoja repetida: '+name);const target=targets.get(attr(sheet,'id'));if(!target)throw Error('No se encuentra la hoja '+name);result.sheets[name]=sheetRows(xmlTree(await boundedText(zip.file(pathFor(target)))),shared,percentageStyles);}
 if(!result.sheets.Datos)throw Error('Usa la plantilla de la app: falta la hoja Datos.');return result;
}
global.GEIXlsx={read};
})(globalThis);
