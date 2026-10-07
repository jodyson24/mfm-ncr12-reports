export type LogFields=Record<string,string|number|boolean|undefined>;
const write=(level:'info'|'warn'|'error',event:string,fields:LogFields={})=>{const entry={timestamp:new Date().toISOString(),level,event,...fields};const line=JSON.stringify(entry);if(level==='error')console.error(line);else if(level==='warn')console.warn(line);else console.log(line)};
export const log={info:(event:string,fields?:LogFields)=>write('info',event,fields),warn:(event:string,fields?:LogFields)=>write('warn',event,fields),error:(event:string,fields?:LogFields)=>write('error',event,fields)};
