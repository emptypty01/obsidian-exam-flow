export class Modal {
    modalEl=document.createElement('div');contentEl=document.createElement('div');titleEl=document.createElement('h2');
    constructor(_app:unknown){this.modalEl.className='modal';this.modalEl.append(this.titleEl,this.contentEl);}
    open(){document.body.append(this.modalEl);(this as unknown as {onOpen:()=>void}).onOpen();}
    close(){this.modalEl.remove();(this as unknown as {onClose:()=>void}).onClose();}
}
export class Setting {
    constructor(private container:HTMLElement){}
    addButton(callback:(button:Button)=>unknown){callback(new Button(this.container));return this;}
}
export class Plugin {}
export class ItemView {}
export class PluginSettingTab {}
export class Notice {constructor(_message:string){}}
export class TFolder {constructor(public path:string){}}
export class TFile {
    extension:string;
    constructor(public path:string){this.extension=path.split('.').at(-1)??'';}
}
export const parseYaml=JSON.parse,stringifyYaml=JSON.stringify;
export async function requestUrl(){throw new Error('隔离浏览器验证禁止真实请求');}
class Button {
    private button=document.createElement('button');
    constructor(container:HTMLElement){container.append(this.button);}
    setButtonText(text:string){this.button.textContent=text;return this;}
    onClick(callback:()=>unknown){this.button.onclick=()=>{void callback();};return this;}
    setDisabled(value:boolean){this.button.disabled=value;return this;}
    setCta(){return this;}
}
