import {App,Modal,Setting} from 'obsidian';
export function confirm(app:App,title:string,description:string):Promise<boolean>{
    return new Promise(resolve=>{
        let done=false;
        class Confirm extends Modal {
            onOpen(){this.titleEl.setText(title);this.contentEl.createEl('p',{text:description,cls:'examflow-preview'});new Setting(this.contentEl).addButton(b=>b.setButtonText('取消').onClick(()=>this.close())).addButton(b=>b.setButtonText('确认').setCta().onClick(()=>{done=true;this.close();}));}
            onClose(){this.contentEl.empty();resolve(done);}
        }
        new Confirm(app).open();
    });
}
export function editJson<T>(app:App,title:string,value:T,onSave:(value:T)=>Promise<void>):void{
    class Editor extends Modal {
        onOpen(){
            this.titleEl.setText(title);this.modalEl.addClass('examflow-editor');
            this.contentEl.createEl('p',{text:'按公开数据格式编辑；保存前校验，错误时保留输入。'});
            const area=this.contentEl.createEl('textarea',{attr:{'aria-label':title}});area.value=JSON.stringify(value,null,2);area.rows=24;area.spellcheck=false;
            const error=this.contentEl.createEl('p',{attr:{role:'alert'}});
            new Setting(this.contentEl).addButton(b=>b.setButtonText('取消').onClick(()=>this.close())).addButton(b=>b.setButtonText('校验并保存').setCta().onClick(async()=>{
                b.setDisabled(true);try{await onSave(JSON.parse(area.value) as T);this.close();}catch(e){error.setText(e instanceof Error?e.message:'保存失败，请检查输入');}finally{b.setDisabled(false);}
            }));
        }
        onClose(){this.contentEl.empty();}
    }
    new Editor(app).open();
}
export function choose(app:App,title:string,description:string,options:string[]):Promise<string|null>{
    return new Promise(resolve=>{let selected:string|null=null;class Choice extends Modal{onOpen(){this.titleEl.setText(title);this.contentEl.createEl('p',{text:description,cls:'examflow-preview'});const setting=new Setting(this.contentEl);for(const option of options)setting.addButton(b=>b.setButtonText(option).onClick(()=>{selected=option;this.close();}));}onClose(){resolve(selected);}}new Choice(app).open();});
}
export async function pickFile(accept:string):Promise<File|null>{
    return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;
        input.onchange=()=>resolve(input.files?.[0]??null);input.oncancel=()=>resolve(null);input.click();});
}
export function download(name:string,text:string):void{
    const url=URL.createObjectURL(new Blob([text],{type:name.endsWith('.json')?'application/json':'text/markdown;charset=utf-8'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
