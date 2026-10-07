export type ReportFilters={search?:string;organisation?:string;category?:string;periodStart?:string;periodEnd?:string;page?:number};
export const encodeFilters=(filters:ReportFilters)=>{const params=new URLSearchParams();for(const [key,value] of Object.entries(filters)){if(value!==undefined&&value!=='')params.set(key,String(value));}return params.toString();};
export const decodeFilters=(query:string):ReportFilters=>{const p=new URLSearchParams(query);const page=p.get('page');return{search:p.get('search')||undefined,organisation:p.get('organisation')||undefined,category:p.get('category')||undefined,periodStart:p.get('periodStart')||undefined,periodEnd:p.get('periodEnd')||undefined,page:page?Number(page):undefined};};
export const formatLagos=(iso:string)=>new Intl.DateTimeFormat('en-NG',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Lagos'}).format(new Date(iso));
export const formatPeriod=(start:string,end:string)=>`${start} – ${end}`;
