import {ArchiveService,type ArchiveStatus} from '../../../server/src/archives/service.js';
export type ArchiveRunner={build:(reportId:string)=>Promise<string>};
export async function processArchive(service:ArchiveService,reportId:string,runner:ArchiveRunner){const lease=service.claim(reportId);if(!lease)return false;try{const url=await runner.build(reportId);return service.finish(lease,true,url)}catch{return service.finish(lease,false)}}
export function archiveLeaseKey(status:ArchiveStatus){return `${status.reportId}:${status.generation}`}
