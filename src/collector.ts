import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** One background collector per local VS Code storage profile. Stale process
 * locks are recoverable after a crash; other windows can still refresh manually. */
export class CollectorLease {
  private token = randomUUID();
  private owned = false;
  private file?: string;
  constructor(private directory?: string) { if (directory) this.file=join(directory,'shipstats-collection.lock'); }
  async acquire(): Promise<boolean> {
    if (!this.file || this.owned) return true;
    await fs.mkdir(this.directory!,{recursive:true});
    const payload=JSON.stringify({pid:process.pid,token:this.token});
    for(let attempt=0;attempt<2;attempt++) {
      try { const handle=await fs.open(this.file,'wx');try{await handle.writeFile(payload,'utf8');}finally{await handle.close();}this.owned=true;return true; }
      catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
      let old:string;
      try {if((await fs.stat(this.file)).size>512)return false;old=await fs.readFile(this.file,'utf8');const lease=JSON.parse(old);if(!Number.isInteger(lease.pid)||lease.pid<=0||typeof lease.token!=='string')return false;
        try {process.kill(lease.pid,0);return false;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')return false;}
        if(await fs.readFile(this.file,'utf8')===old)await fs.unlink(this.file);
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return false;}
    }
    return false;
  }
  async release(): Promise<void> {
    if(!this.file||!this.owned)return;this.owned=false;
    try {const lease=JSON.parse(await fs.readFile(this.file,'utf8'));if(lease.token===this.token)await fs.unlink(this.file);}catch{/* A closed/deleted profile no longer needs its lease. */}
  }
}
