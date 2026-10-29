import type {Question,QuestionBank} from '../types/domain';
import {clone,now,id} from '../core';
import {newQuestion} from '../seed';
import {validateQuestion} from '../domain/validation';
import {bankSchema} from './schemas';
import {Storage,safePath} from './storage';

interface CompactQuestion {
    id:string;stem:string;answer:Question['answer']|string|string[]|boolean;
    options?:Record<string,string>;explanation?:string;type?:Question['type'];points?:number;rubric?:unknown;
    source?:number;no?:string;page?:number;version?:number;difficulty?:number;reviewStatus?:Question['reviewStatus'];
    tags?:string[];chapterIds?:string[];syllabusNodeIds?:string[];knowledgePointIds?:string[];duplicateOf?:string;
    scoringRule?:Question['scoringRule'];
    ai?:string[];
}
interface CompactFile {schemaVersion:2;examId:string;subjectId:string;type:Question['type'];tags?:string[];ai?:string[];sources:Question['source'][];questions:CompactQuestion[]}
interface BankEntry {bank:Omit<QuestionBank,'questions'>;files:string[]}
interface BankIndex {schemaVersion:2;revision?:string;banks:BankEntry[]}
interface Journal {previous:Record<string,string|null>;next:Record<string,string|null>}
const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value;
const stable=(value:unknown)=>JSON.stringify(ordered(value));

export function examSession(source:Question['source']):string {
    const text=source.examSession??'';
    if(text.includes('上'))return '上';if(text.includes('下'))return '下';
    const month=text.match(/\d{4}[-年/](\d{1,2})[-月/]/)?.[1];
    return month?(Number(month)<=6?'上':'下'):'批次未知';
}
export function subjectType(name:string,types:Question['type'][]):Question['type'] {
    return name.includes('论文')||types.includes('essay')?'essay':name.includes('案例')||types.includes('case_analysis')||types.includes('short_answer')?'short_answer':'single_choice';
}
function encode(questions:Question[],type:Question['type']):CompactFile {
    const sources:Question['source'][]=[];
    const commonTags=questions.every(q=>stable(q.tags)===stable(questions[0]!.tags))?questions[0]!.tags:[];
    const aiFields=(q:Question)=>{const info=q.extra?.examflowImport as {answerOrigin?:string;supplementedFields?:unknown}|undefined;return [...new Set([...(Array.isArray(info?.supplementedFields)?info.supplementedFields.filter((field):field is string=>typeof field==='string'):[]),...(info?.answerOrigin==='ai'?['answer']:[])])].sort();};
    const commonAi=questions.every(q=>stable(aiFields(q))===stable(aiFields(questions[0]!)))?aiFields(questions[0]!):[];
    const compact=questions.map(q=>{
        const {questionNo,page,...source}=q.source;
        let sourceId=sources.findIndex(s=>stable(s)===stable(source));if(sourceId<0){sourceId=sources.length;sources.push(source);}
        const result:CompactQuestion={id:q.id,stem:q.stem,answer:q.answer.kind==='single_choice'?q.answer.optionKey:q.answer.kind==='multiple_choice'?q.answer.optionKeys:q.answer.kind==='true_false'?q.answer.value:q.answer.kind==='subjective'?q.answer.referenceAnswer:q.answer};
        if(q.options?.length)result.options=Object.fromEntries(q.options.map(o=>[o.key,o.text]));
        if(q.explanation)result.explanation=q.explanation;
        if(q.type!==type)result.type=q.type;
        if(q.scoringRule.points!==1)result.points=q.scoringRule.points;
        if(q.answer.kind==='subjective'&&q.answer.rubric.length)result.rubric=q.answer.rubric;
        if(sourceId)result.source=sourceId;if(questionNo)result.no=questionNo;if(page)result.page=page;
        if(q.version!==1)result.version=q.version;if(q.difficulty!==2)result.difficulty=q.difficulty;
        if(q.reviewStatus!=='approved')result.reviewStatus=q.reviewStatus;
        if(stable(q.tags)!==stable(commonTags))result.tags=q.tags;
        if(stable(aiFields(q))!==stable(commonAi))result.ai=aiFields(q);
        for(const key of ['chapterIds','syllabusNodeIds','knowledgePointIds'] as const)if(q[key].length)result[key]=q[key];
        if(q.duplicateOf)result.duplicateOf=q.duplicateOf;
        if(stable({...q.scoringRule,points:1})!==stable(newQuestion().scoringRule))result.scoringRule=q.scoringRule;
        return result;
    });
    return {schemaVersion:2,examId:questions[0]!.examId,subjectId:questions[0]!.subjectId,type,...commonTags.length?{tags:commonTags}:{},...commonAi.length?{ai:commonAi}:{},sources,questions:compact};
}
export function decodeCompactFile(raw:unknown,bank:Omit<QuestionBank,'questions'>):Question[] {
    const file=raw as CompactFile;
    if(file.schemaVersion!==2||file.examId!==bank.examId||file.subjectId!==bank.subjectId||!Array.isArray(file.sources)||!Array.isArray(file.questions))throw new Error('精简题库格式或归属无效');
    return file.questions.map(q=>{
        const type=q.type??file.type,source=file.sources[q.source??0],ai=q.ai??file.ai??[];if(!source)throw new Error('题目来源引用无效');
        const answer:unknown=typeof q.answer==='string'?type==='single_choice'?{kind:type,optionKey:q.answer}:{kind:'subjective',referenceAnswer:q.answer,rubric:q.rubric??[]}:typeof q.answer==='boolean'?{kind:'true_false',value:q.answer}:Array.isArray(q.answer)?{kind:'multiple_choice',optionKeys:q.answer}:q.answer;
        return validateQuestion({...newQuestion(),id:q.id,createdAt:bank.createdAt,updatedAt:bank.updatedAt,stem:q.stem,type,answer,
            options:q.options?Object.entries(q.options).map(([key,text])=>({key,text})):undefined,explanation:q.explanation,
            examId:file.examId,subjectId:file.subjectId,scoringRule:q.scoringRule??{...newQuestion().scoringRule,points:q.points??1},
            chapterIds:q.chapterIds??[],syllabusNodeIds:q.syllabusNodeIds??[],knowledgePointIds:q.knowledgePointIds??[],tags:q.tags??file.tags??[],
            difficulty:q.difficulty??2,reviewStatus:q.reviewStatus??'approved',version:q.version??1,duplicateOf:q.duplicateOf,
            source:{...source,questionNo:q.no,page:q.page},generationMethod:source.type==='ai_generated'?'ai':source.type==='real_exam'?'import':'manual',
            extra:ai.length?{examflowImport:{answerOrigin:ai.includes('answer')?'ai':'source',supplementedFields:ai}}:undefined});
    });
}
export function compactBankDocuments(bank:QuestionBank,subject:{name:string;questionTypes:Question['type'][]}){
    const groups=new Map<string,Question[]>();
    for(const q of bank.questions){
        const label=q.source.type==='real_exam'?`${q.source.examYear??'年份未知'}${examSession(q.source)}`:q.source.type==='ai_generated'?'AI':'其他';
        const group=groups.get(label)??[];group.push(q);groups.set(label,group);
    }
    const name=subject.name.replace(/[\\/:*?"<>|.]/g,'_');
    return Object.fromEntries([...groups].map(([label,questions])=>[`${label}-${name}.json`,encode(questions,subjectType(subject.name,subject.questionTypes))]));
}

/** 平面 JSON 文件配合提交索引和恢复日志，避免跨年份移动失败时丢题。 */
export class CompactBankStore {
    constructor(private storage:Storage,private root:string){}
    private path(file:string){return `${this.root}/${safePath(file)}`;}
    private async apply(changes:Record<string,string|null>,expected:Record<string,string|null>){
        for(const [file,value] of Object.entries(changes)){
            const current=await this.storage.readText(file);
            if(current!==value&&current!==expected[file])throw new Error(`题库保存期间存在外部修改：${file}`);
            if(current===value)continue;
            if(value===null){if(await this.storage.adapter.exists(file))await this.storage.adapter.remove(file);}
            else await this.storage.writeText(file,value);
        }
    }
    async recover(){
        const file=this.path('banks/.transaction.json'),journal=await this.storage.readJson<Journal>(file);if(!journal)return;
        const index=this.path('banks/index.json'),committed=await this.storage.readText(index)===journal.next[index];
        await this.apply(committed?journal.next:journal.previous,committed?journal.previous:journal.next);
        await this.storage.adapter.remove(file);
    }
    async load():Promise<QuestionBank[]>{
        await this.recover();
        const index=await this.storage.readJson<BankIndex>(this.path('banks/index.json'));
        if(index){
            if(index.schemaVersion!==2||!Array.isArray(index.banks))throw new Error('题库索引版本不支持');
            const banks:QuestionBank[]=[];
            for(const entry of index.banks){
                const questions:Question[]=[];
                for(const name of entry.files){const raw=await this.storage.readJson(this.path(`banks/${safePath(name)}`));if(!raw)throw new Error(`题库分片缺失：${name}`);questions.push(...decodeCompactFile(raw,entry.bank));}
                banks.push(bankSchema.parse({...entry.bank,questions}) as QuestionBank);
            }
            if(new Set(banks.flatMap(b=>b.questions.map(q=>q.id))).size!==banks.reduce((n,b)=>n+b.questions.length,0))throw new Error('题库存在重复题目 ID');
            return banks;
        }
        const banks:QuestionBank[]=[];
        for(const file of await this.storage.list(this.path('banks')))if(file.endsWith('.json')&&!file.includes('.conflict-')&&!file.split('/').at(-1)!.startsWith('.')){
            const raw=await this.storage.readJson(file);if(raw)banks.push(bankSchema.parse(raw) as QuestionBank);
        }
        return banks;
    }
    async save(banks:QuestionBank[],subjects:{id:string;name:string;questionTypes:Question['type'][]}[]):Promise<void>{
        const journalFile=this.path('banks/.transaction.json');
        if(await this.storage.readText(journalFile)!==null)throw new Error('存在未完成题库保存，请重新加载后恢复');
        const next:Record<string,string|null>={},index:BankIndex={schemaVersion:2,revision:id('commit'),banks:[]},used=new Set<string>();
        for(const bank of banks){
            const subject=subjects.find(s=>s.id===bank.subjectId);if(!subject)throw new Error('题库科目不存在');
            const files:string[]=[];
            for(const [base,document]of Object.entries(compactBankDocuments(bank,subject))){
                let name=base;if(used.has(name))name=`${base.slice(0,-5)}-${bank.subjectId}.json`;if(used.has(name))throw new Error('题库文件名冲突');
                used.add(name);files.push(name);next[this.path(`banks/${name}`)]=JSON.stringify(document,null,2);
            }
            const {questions,...metadata}=bank;index.banks.push({bank:metadata,files});
        }
        const indexFile=this.path('banks/index.json');
        const previous:Record<string,string|null>={};
        for(const file of await this.storage.list(this.path('banks')))if(file.endsWith('.json')&&!file.includes('.conflict-')&&!file.split('/').at(-1)!.startsWith('.')){
            previous[file]=await this.storage.readText(file);if(!(file in next)&&file!==indexFile)next[file]=null;
        }
        next[indexFile]=JSON.stringify(index,null,2);
        for(const file of Object.keys(next))if(!(file in previous))previous[file]=await this.storage.readText(file);
        // 在任何原文件变更前保存完整旧内容，解析审计等被精简字段也保留在这份备份。
        await this.storage.writeJson(this.path(`_backup/banks/${id('migration')}/original.json`),{createdAt:now(),files:previous,banks:clone(banks)});
        const journal={previous,next};await this.storage.writeJson(journalFile,journal);
        try{
            const writes=Object.fromEntries(Object.entries(next).filter(([file,value])=>file!==indexFile&&value!==null));
            await this.apply(writes,previous);
            await this.storage.writeText(indexFile,next[indexFile]!);
            await this.apply(Object.fromEntries(Object.entries(next).filter(([,value])=>value===null)),previous);
            await this.storage.adapter.remove(journalFile);
        }catch(error){const committed=await this.storage.readText(indexFile)===next[indexFile];await this.recover();if(!committed)throw error;}
    }
}
