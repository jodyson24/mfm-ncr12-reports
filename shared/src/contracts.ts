export type ReportInput={organisation:string;uploader:string;title:string;description:string;periodStart:string;periodEnd:string;acknowledgement:true};
export type ReportQuery={search?:string;organisation?:string;category?:'image'|'video'|'audio'|'pdf'|'powerpoint';periodStart?:string;periodEnd?:string;page?:number};
export class ApiError extends Error{constructor(public readonly code:string,message:string,public readonly fields:Record<string,string>={}){super(message);this.name='ApiError';}}
