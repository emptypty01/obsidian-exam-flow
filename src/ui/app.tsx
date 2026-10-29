import {useEffect,useId,useRef,useState} from 'preact/hooks';
import {cloneElement,isValidElement,type ComponentChildren,type VNode} from 'preact';
import type ExamFlowPlugin from '../main';
import type {Attempt,Question,QuestionType,PaperConfig,UserAnswer} from '../types/domain';
import {clone,round} from '../core';
import {confirm,editJson,download} from './dialogs';
import {answered} from '../domain/attempt';
import {suggestGrade} from '../ai/tasks';
import {duplicateSimilarity,validateQuestion} from '../domain/validation';
import {subjectType,examSession} from '../data/compact-banks';

const routes:Record<string,string>={home:'首页',bank:'题库',generate:'组卷',exam:'考试',wrong:'错题',history:'试卷历史'};
const titles={...routes,report:'报告',conflicts:'同步冲突'} as Record<string,string>;
export const typeNames:Record<QuestionType,string>={single_choice:'单选',multiple_choice:'多选',true_false:'判断',fill_blank:'填空',short_answer:'简答',case_analysis:'案例',essay:'论文'};
const statusNames:Record<string,string>={draft:'草稿',pending_review:'待审核',approved:'已审核',rejected:'拒绝',in_progress:'进行中',submitted:'已交卷待评分',graded:'已评分',abandoned:'已放弃'};
const paperModes={real:'真题',ai:'AI出题',mixed:'真题+AI'};
const hasAiAnswer=(q:Question)=>q.source.type==='ai_generated'||(q.extra?.examflowImport as {answerOrigin?:string}|undefined)?.answerOrigin==='ai';
function Field({label,children}:{label:string;children:ComponentChildren}){
    const id=useId();
    return <label class="ef-field"><span id={id}>{label}</span>{isValidElement(children)?cloneElement(children as VNode<{'aria-labelledby'?:string}>,{'aria-labelledby':id}):children}</label>;
}
function Empty({children}:{children:ComponentChildren}){return <p class="ef-empty">{children}</p>;}
export function AppView({plugin:p}: {plugin:ExamFlowPlugin;revision?:number}){
    const [,tick]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
    useEffect(()=>{const callback=()=>tick(v=>v+1);p.listeners.add(callback);return()=>{p.listeners.delete(callback);};},[p]);
    const go=(route:string)=>{if(p.route==='exam')void p.service.flush().catch(p.error);setError('');p.route=route;p.notify();};
    const run=(task:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');p.operationController=new AbortController();p.aiProgress='';void task().then(()=>p.notify()).catch(e=>setError(p.message(e))).finally(()=>{setBusy(false);p.operationController=undefined;});};
    const props={p,go,run};
    return <div class="ef-root" aria-busy={busy}>
        <header class="ef-header"><h1>ExamFlow</h1><span>本地题库与考试</span></header>
        <nav aria-label="ExamFlow 页面">{Object.entries(routes).map(([route,name])=><button type="button" aria-current={p.route===route?'page':undefined} onClick={()=>go(route)}>{name}</button>)}</nav>
        {busy&&<div role="status">正在处理… <button onClick={()=>p.operationController?.abort()}>取消 AI 请求</button>{p.aiProgress&&<details><summary>模型输出中</summary><pre>{p.aiProgress}</pre></details>}</div>}{error&&<p class="ef-error" role="alert">{error}</p>}
        <main><h2>{titles[p.route]}</h2>
            {p.route==='home'&&<Home {...props}/>}{p.route==='bank'&&<Bank {...props}/>}
            {p.route==='generate'&&<Generate {...props}/>}{p.route==='exam'&&<Exam {...props}/>}{p.route==='report'&&<Report {...props}/>}
            {p.route==='wrong'&&<Wrong {...props}/>}
            {p.route==='history'&&<History {...props}/>}{p.route==='conflicts'&&<Conflicts {...props}/>}
        </main>
    </div>;
}
interface Props{p:ExamFlowPlugin;go:(route:string)=>void;run:(task:()=>Promise<unknown>)=>void}
function Home({p,go,run}:Props){
    const active=p.repo.attempts.filter(a=>a.status==='in_progress');
    return <><p>管理真题题库，生成真题、AI 或混合试卷；每次组卷都会保留历史。</p>
        <div class="ef-metrics"><div><strong>{p.repo.questions.length}</strong>道题目</div><div><strong>{p.repo.papers.length}</strong>份试卷</div></div>
        <div class="ef-actions"><button onClick={()=>go('bank')}>管理题库</button><button onClick={()=>go('generate')}>开始组卷</button><button onClick={()=>go('history')}>试卷历史</button></div>
        <h3>继续考试</h3>{active.length?active.map(a=><article><b>{a.paperTitle}</b><p>截止：{new Date(a.deadlineAt).toLocaleString()}</p><button onClick={()=>run(async()=>{await p.service.resume(a);go(p.service.current?.status==='in_progress'?'exam':'report');})}>继续</button><button onClick={()=>run(async()=>{if(await confirm(p.app,'放弃考试','此操作会结束本次答卷。'))await p.service.abandon(a);})}>放弃</button></article>):<Empty>没有进行中的考试。</Empty>}
    </>;
}
function advancedQuestion(p:ExamFlowPlugin,q:Question,save:(value:Question)=>Promise<void>){
    editJson(p.app,'题目高级字段',{id:q.id,type:q.type,stem:q.stem,options:q.options,answer:q.answer,explanation:q.explanation,points:q.scoringRule.points,source:q.source,reviewStatus:q.reviewStatus},async value=>{
        if(value.id!==q.id)throw new Error('已有题目 ID 不可修改');
        const next=validateQuestion({...q,...value,scoringRule:{...q.scoringRule,points:value.points}});await save(next);
    });
}
function Bank({p,run}:Props){
    const [text,setText]=useState(''),[subject,setSubject]=useState(''),[year,setYear]=useState(''),[page,setPage]=useState(0),[editing,setEditing]=useState<Question|null>(null),[saved,setSaved]=useState('');
    const editTrigger=useRef<HTMLElement|null>(null);
    const years=[...new Set(p.repo.questions.filter(q=>q.source.type==='real_exam'&&q.source.examYear!==undefined).map(q=>q.source.examYear!))].sort((a,b)=>b-a);
    const questions=p.repo.questions.filter(q=>(!subject||q.subjectId===subject)&&(!year||(q.source.type==='real_exam'&&(year==='unknown'?q.source.examYear===undefined:q.source.examYear===Number(year))))&&`${q.stem} ${q.tags.join(' ')}`.toLowerCase().includes(text.toLowerCase()));
    const pages=Math.max(1,Math.ceil(questions.length/50)),current=Math.min(page,pages-1);
    const edit=(q:Question)=>{editTrigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setSaved('');setEditing(clone(q));};
    const close=()=>{setEditing(null);requestAnimationFrame(()=>editTrigger.current?.focus());};
    const editor=(q:Question)=><QuestionEditor key={q.id} question={q} p={p} close={close} saved={()=>{setSaved('题目已保存');close();}}/>;
    const resetPage=()=>{setPage(0);setEditing(null);};
    return <><div class="ef-actions"><button onClick={()=>edit(p.makeQuestion(subject||undefined))}>新建题目</button><button onClick={()=>run(()=>p.importBank())}>导入 JSON</button><button onClick={()=>p.exportBank()}>导出 JSON</button><button onClick={()=>p.exportBank(true)}>导出 Markdown</button><button onClick={()=>run(async()=>{if(await confirm(p.app,'移除示例题','仅移除来源为 sample 的题目，历史试卷快照保留。'))for(const b of [...p.repo.banks])await p.repo.saveBank({...b,questions:b.questions.filter(q=>q.source.type!=='sample')});})}>移除示例题</button></div>
        <div class="ef-filters"><Field label="搜索题干或标签"><input value={text} onInput={e=>{setText(e.currentTarget.value);resetPage();}}/></Field><Field label="科目"><select value={subject} onChange={e=>{setSubject(e.currentTarget.value);resetPage();}}><option value="">全部科目</option>{p.repo.exams.flatMap(e=>e.subjects).map(s=><option value={s.id}>{s.name}</option>)}</select></Field><Field label="真题年份"><select value={year} onChange={e=>{setYear(e.currentTarget.value);resetPage();}}><option value="">全部年份</option>{years.map(y=><option value={String(y)}>{y} 年</option>)}<option value="unknown">未标注年份的真题</option></select></Field></div>
        {saved&&<p role="status">{saved}</p>}
        {editing&&!p.repo.questions.some(q=>q.id===editing.id)&&editor(editing)}
        <p>{questions.length} 道，第 {current+1} / {pages} 页</p>
        {!questions.length&&<Empty>没有匹配题目。请调整筛选、创建题目或导入题库。</Empty>}
        {questions.slice(current*50,current*50+50).map(q=><article key={q.id} class="ef-bank-question">
            <div class="ef-question-row"><div><p class="ef-stem" title={q.stem}>{q.stem}</p><small>{q.source.type==='real_exam'?`${q.source.examYear??'年份未知'}${examSession(q.source)} · 真题`:'非真题'}</small></div>
                <div class="ef-actions"><button aria-expanded={editing?.id===q.id} onClick={()=>edit(q)}>编辑</button><button onClick={()=>run(async()=>{if(await confirm(p.app,'删除题目','仅删除题库题目，已生成的试卷快照不受影响。')){await p.repo.removeQuestion(q.id);setEditing(null);setSaved('题目已删除');}})}>删除</button><button onClick={()=>advancedQuestion(p,q,async value=>{await p.repo.saveQuestion(value);setSaved('题目已保存');p.notify();})}>高级字段</button></div>
            </div>{editing?.id===q.id&&editor(editing)}
        </article>)}
        <div class="ef-actions"><button disabled={current===0} onClick={()=>{setPage(current-1);setEditing(null);}}>上一页</button><button disabled={current>=pages-1} onClick={()=>{setPage(current+1);setEditing(null);}}>下一页</button></div>
    </>;
}
function QuestionEditor({question,p,close,saved}:{question:Question;p:ExamFlowPlugin;close:()=>void;saved:()=>void}){
    const [q,setQ]=useState(question),[error,setError]=useState(''),[saving,setSaving]=useState(false);
    const stemInput=useRef<HTMLTextAreaElement>(null);
    useEffect(()=>{stemInput.current?.focus({preventScroll:true});stemInput.current?.scrollIntoView({block:'center'});},[]);
    const update=(change:Partial<Question>)=>setQ({...q,...change});
    const chooseType=(type:QuestionType)=>{
        const answer:Question['answer']=type==='single_choice'?{kind:type,optionKey:'A'}:type==='multiple_choice'?{kind:type,optionKeys:['A']}:type==='true_false'?{kind:type,value:true}:type==='fill_blank'?{kind:type,blanks:[{accepted:['答案'] }]}:{kind:'subjective',referenceAnswer:'参考答案',rubric:[{id:'rubric_1',description:'评分维度',points:q.scoringRule.points}]};
        update({type,answer,options:['single_choice','multiple_choice'].includes(type)?[{key:'A',text:'选项 A'},{key:'B',text:'选项 B'}]:undefined});
    };
    return <section id={`ef-edit-${q.id}`} class="ef-editor" aria-label="题目编辑"><h3>编辑题目</h3>{hasAiAnswer(q)&&<p>参考答案由 AI 补充或生成，请结合原资料核对。</p>}<Field label="题型"><select value={q.type} onChange={e=>chooseType(e.currentTarget.value as QuestionType)}>{Object.entries(typeNames).map(([k,v])=><option value={k}>{v}</option>)}</select></Field>
        <Field label="题干（填空使用 {{1}}、{{2}}）"><textarea ref={stemInput} value={q.stem} onInput={e=>update({stem:e.currentTarget.value})}/></Field>
        <Field label="科目"><select value={q.subjectId} onChange={e=>update({subjectId:e.currentTarget.value})}>{p.repo.exams.flatMap(e=>e.subjects).map(s=><option value={s.id}>{s.name}</option>)}</select></Field>
        {q.source.type==='real_exam'&&<Field label="真题年份"><input type="number" min="1" step="1" value={q.source.examYear??''} onInput={e=>update({source:{...q.source,examYear:e.currentTarget.value?Number(e.currentTarget.value):undefined}})}/></Field>}
        {q.source.type==='real_exam'&&<Field label="真题批次"><select value={examSession(q.source)} onChange={e=>update({source:{...q.source,examSession:e.currentTarget.value==='批次未知'?undefined:e.currentTarget.value}})}><option value="上">上半年</option><option value="下">下半年</option><option value="批次未知">未知批次</option></select></Field>}
        <Field label="分值"><input type="number" min="0.01" step="0.01" value={q.scoringRule.points} onInput={e=>update({scoringRule:{...q.scoringRule,points:Number(e.currentTarget.value)}})}/></Field>
        {q.options?.map((option,i)=><Field label={`选项 ${option.key}`}><input value={option.text} onInput={e=>update({options:q.options!.map((o,n)=>n===i?{...o,text:e.currentTarget.value}:o)})}/></Field>)}
        {q.options&&<button onClick={()=>update({options:[...q.options!,{key:String.fromCharCode(65+q.options!.length),text:'新选项'}]})}>添加选项</button>}
        {q.answer.kind==='single_choice'&&<Field label="正确选项"><select value={q.answer.optionKey} onChange={e=>update({answer:{kind:'single_choice',optionKey:e.currentTarget.value}})}>{q.options?.map(o=><option>{o.key}</option>)}</select></Field>}
        {q.answer.kind==='multiple_choice'&&<Field label="正确选项（英文逗号分隔）"><input value={q.answer.optionKeys.join(',')} onInput={e=>update({answer:{kind:'multiple_choice',optionKeys:e.currentTarget.value.split(',').map(s=>s.trim()).filter(Boolean)}})}/></Field>}
        {q.answer.kind==='true_false'&&<Field label="标准答案"><select value={String(q.answer.value)} onChange={e=>update({answer:{kind:'true_false',value:e.currentTarget.value==='true'}})}><option value="true">正确</option><option value="false">错误</option></select></Field>}
        {q.answer.kind==='fill_blank'&&<Field label="填空答案（每行一个空，同义答案用 | 分隔）"><textarea value={q.answer.blanks.map(b=>b.accepted.join('|')).join('\n')} onInput={e=>update({answer:{kind:'fill_blank',blanks:e.currentTarget.value.split('\n').map(line=>({accepted:line.split('|')}))}})}/></Field>}
        {q.answer.kind==='subjective'&&<><Field label="参考答案"><textarea value={q.answer.referenceAnswer} onInput={e=>{if(q.answer.kind==='subjective')update({answer:{...q.answer,referenceAnswer:e.currentTarget.value}});}}/></Field><button onClick={()=>editJson(p.app,'评分维度',q.answer.kind==='subjective'?q.answer.rubric:[],async rubric=>{if(q.answer.kind==='subjective')update({answer:{...q.answer,rubric}});})}>编辑评分维度 / 子问题</button></>}
        <Field label="解析"><textarea value={q.explanation??''} onInput={e=>update({explanation:e.currentTarget.value})}/></Field>
        <Field label="审核状态"><select value={q.reviewStatus} onChange={e=>update({reviewStatus:e.currentTarget.value as Question['reviewStatus']})}>{['draft','pending_review','approved','rejected'].map(v=><option value={v}>{statusNames[v]}</option>)}</select></Field>
        <div class="ef-actions"><button disabled={saving} onClick={()=>advancedQuestion(p,q,async value=>setQ(value))}>高级字段</button><button disabled={saving} onClick={()=>p.run(async()=>{const result=await p.aiChat({messages:[{role:'system',content:'校验题目逻辑、答案、解析与来源的一致性。仅给出审查建议，不替代人工审核。'},{role:'user',content:JSON.stringify(q)}]});if(result)await confirm(p.app,'AI 校验建议（仅供参考）',result.content);})}>AI 校验</button>
            {p.repo.questions.some(old=>old.id===q.id)&&<button disabled={saving} onClick={async()=>{setSaving(true);try{if(await confirm(p.app,'删除题目','历史试卷保留快照，确定删除题库中的题目？')){await p.repo.removeQuestion(q.id);p.notify();close();}}catch(e){setError(p.message(e));}finally{setSaving(false);}}}>删除题目</button>}
        </div>
        {error&&<p role="alert" class="ef-error">{error}</p>}<div class="ef-actions"><button disabled={saving} onClick={close}>取消</button><button disabled={saving} onClick={async()=>{setSaving(true);setError('');try{validateQuestion(q);const similar=p.repo.questions.find(x=>x.id!==q.id&&duplicateSimilarity(x,q)>=0.9);if(similar&&!await confirm(p.app,'疑似重复',`与 ${similar.id} 相似。是否仍然保存？`))return;await p.repo.saveQuestion(q);p.notify();saved();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setSaving(false);}}}>{saving?'正在保存…':'校验并保存'}</button></div>
    </section>;
}
function Generate({p,go,run}:Props){
    const exam=p.activeExam;
    const [subject,setSubject]=useState(exam.subjects[0]!.id),[mode,setMode]=useState<PaperConfig['mode']>('real'),[count,setCount]=useState(10),[aiCount,setAiCount]=useState(5),[batch,setBatch]=useState(''),[minutes,setMinutes]=useState(exam.subjects[0]!.defaultDurationMinutes),[instruction,setInstruction]=useState('');
    const selected=exam.subjects.find(s=>s.id===subject)!,type=subjectType(selected.name,selected.questionTypes);
    const batches=[...new Set(p.repo.questions.filter(q=>q.examId===exam.id&&q.subjectId===subject&&q.source.type==='real_exam').map(q=>`${q.source.examYear??'未知'}${examSession(q.source)}`))].sort().reverse();
    return <><div class="ef-filters"><Field label="组卷类型"><select value={mode} onChange={e=>{const value=e.currentTarget.value as PaperConfig['mode'];setMode(value);if(value==='mixed'&&count<2)setCount(2);setAiCount(Math.max(1,Math.floor(Math.max(2,count)/2)));}}>{Object.entries(paperModes).map(([value,label])=><option value={value}>{label}</option>)}</select></Field>
        <Field label="科目"><select value={subject} onChange={e=>{const next=exam.subjects.find(s=>s.id===e.currentTarget.value)!;const kind=subjectType(next.name,next.questionTypes);setSubject(next.id);setBatch('');setCount(kind==='essay'?(mode==='mixed'?2:1):kind==='short_answer'?3:10);setAiCount(1);setMinutes(next.defaultDurationMinutes);}}>{exam.subjects.map(s=><option value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="题目数量"><input type="number" min={mode==='mixed'?2:1} max="100" value={count} onInput={e=>setCount(Number(e.currentTarget.value))}/></Field></div>
        <p>本次题型：{typeNames[type]}。综合知识默认单选，案例分析为简答，论文科目为论文。</p>
        {mode!=='ai'&&<Field label="真题批次"><select value={batch} onChange={e=>setBatch(e.currentTarget.value)}><option value="">全部批次</option>{batches.map(value=><option value={value}>{value}</option>)}</select></Field>}
        {mode==='mixed'&&<Field label="其中 AI 题目数量"><input type="number" min="1" max={count-1} value={aiCount} onInput={e=>setAiCount(Number(e.currentTarget.value))}/></Field>}
        {mode!=='real'&&<Field label="AI 出题要求"><textarea value={instruction} placeholder="可填写考查范围、难度和主题；生成后需预览确认采用。" onInput={e=>setInstruction(e.currentTarget.value)}/></Field>}
        <Field label="考试时长（分钟）"><input type="number" min="1" value={minutes} onInput={e=>setMinutes(Number(e.currentTarget.value))}/></Field>
        <p>试卷生成后即保存到历史。AI 题标明来源，采用前显示预览；未配置模型时仍可使用真题组卷。</p>
        <div class="ef-actions"><button onClick={()=>run(async()=>{const year=batch.match(/^\d{4}/)?.[0],session=batch.replace(/^\d{4}|^未知/,'');const config:PaperConfig={examId:exam.id,subjectIds:[subject],mode,questionCounts:{[type]:count},durationMinutes:minutes,excludeRecentPapers:0,allowRepeatWithinPaper:false,aiQuestionCount:mode==='mixed'?aiCount:undefined,instruction,examYears:year?[Number(year)]:[],examSessions:batch?[session]:[]};const paper=await p.generateExamPaper(config);if(await confirm(p.app,'试卷已保存',`${paper.title}，${paper.items.length} 题，${paper.totalPoints} 分，${paper.durationMinutes} 分钟。现在开始作答？`)){await p.service.begin(paper);go('exam');}})}>生成并预览</button><button onClick={()=>go('history')}>查看试卷历史</button></div>
    </>;
}
function AnswerInput({q,value,onChange}:{q:Question;value:UserAnswer|null;onChange:(value:UserAnswer)=>void}){
    if(q.type==='single_choice'||q.type==='multiple_choice')return <fieldset><legend>作答</legend>{q.options?.map(o=><label class="ef-option"><input type={q.type==='single_choice'?'radio':'checkbox'} name={q.id} checked={q.type==='single_choice'?value?.optionKey===o.key:value?.optionKeys?.includes(o.key)??false} onChange={e=>onChange(q.type==='single_choice'?{kind:'single_choice',optionKey:o.key}:{kind:'multiple_choice',optionKeys:e.currentTarget.checked?[...value?.optionKeys??[],o.key]:(value?.optionKeys??[]).filter(k=>k!==o.key)})}/>{o.key}. {o.text}</label>)}</fieldset>;
    if(q.type==='true_false')return <fieldset><legend>作答</legend>{[true,false].map(v=><label class="ef-option"><input type="radio" name={q.id} checked={value?.value===v} onChange={()=>onChange({kind:'true_false',value:v})}/>{v?'正确':'错误'}</label>)}</fieldset>;
    if(q.answer.kind==='fill_blank')return <>{q.answer.blanks.map((_,i)=><Field label={`第 ${i+1} 空`}><input value={value?.blanks?.[i]??''} onInput={e=>{const blanks=[...value?.blanks??[]];blanks[i]=e.currentTarget.value;onChange({kind:'fill_blank',blanks});}}/></Field>)}</>;
    if(q.type==='case_analysis'&&q.answer.kind==='subjective'&&q.answer.rubric.length)return <>{q.answer.rubric.map(r=><Field label={`${r.description}（${r.points} 分）`}><textarea class="ef-case-answer" value={value?.subAnswers?.[r.id]??''} onInput={e=>{const subAnswers={...value?.subAnswers,[r.id]:e.currentTarget.value};onChange({kind:'subjective',subAnswers,text:q.answer.kind==='subjective'?q.answer.rubric.map(r=>`${r.description}\n${subAnswers[r.id]??''}`).join('\n\n'):''});}}/></Field>)}</>;
    return <Field label="主观题作答"><textarea class="ef-long-answer" value={value?.text??''} onInput={e=>onChange({kind:'subjective',text:e.currentTarget.value})}/></Field>;
}
function Exam({p,go,run}:Props){
    const [,tick]=useState(0);useEffect(()=>{const t=setInterval(()=>tick(v=>v+1),1000);return()=>clearInterval(t);},[]);
    const a=p.service.current,paper=p.service.paper;
    const [entered,setEntered]=useState(Date.now());
    if(!a||!paper)return <Empty>先组卷或在首页继续考试。</Empty>;
    if(a.status!=='in_progress')return <><p>本次作答已结束，答案已锁定。</p><button onClick={()=>go('report')}>查看报告</button></>;
    const index=a.activeQuestionIndex,item=paper.items[index]!,q=item.snapshot,record=a.answers[q.id],remaining=Math.max(0,Math.ceil((Date.parse(a.deadlineAt)-Date.now())/1000));
    const answeredCount=Object.values(a.answers).filter(r=>answered(r.answer)).length,flags=Object.values(a.answers).filter(r=>r.flagged).length;
    const change=(answer:UserAnswer)=>{const at=Date.now();p.service.answer(q.id,answer,(at-entered)/1000);setEntered(at);};
    const move=(next:number)=>run(async()=>{await p.service.flush();a.activeQuestionIndex=next;await p.service.flush();setEntered(Date.now());p.notify();});
    return <section class="ef-exam"><div class="ef-exam-bar"><strong role="timer" aria-label="剩余时间">{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</strong><span>已答 {answeredCount} / {paper.items.length}</span><button onClick={()=>run(async()=>{if(await confirm(p.app,'确认交卷',`未答 ${paper.items.length-answeredCount} 题，标记 ${flags} 题。交卷后无法修改答案。`)){await p.service.finish();go('report');}})}>交卷</button><button onClick={()=>{const el=document.querySelector('.ef-exam');if(el?.requestFullscreen)void el.requestFullscreen().catch(p.error);}}>全屏</button></div>
        <details><summary>题号导航</summary><div class="ef-palette">{paper.items.map((item,i)=><button aria-current={i===index?'step':undefined} onClick={()=>move(i)}>{i+1}{answered(a.answers[item.questionId]?.answer)?' 已答':''}{a.answers[item.questionId]?.flagged?' ★':''}</button>)}</div></details>
        <h3>{index+1}. {typeNames[q.type]} · {item.points} 分</h3><p class="ef-stem">{q.stem}</p><AnswerInput key={q.id} q={q} value={record?.answer??null} onChange={change}/>
        <div class="ef-actions"><button onClick={()=>{if(!record)p.service.answer(q.id,null);const r=p.service.current!.answers[q.id];if(r){r.flagged=!r.flagged;p.run(()=>p.service.flush());}}}>{record?.flagged?'取消标记':'标记疑问'}</button><button disabled={index===0} onClick={()=>move(index-1)}>上一题</button><button disabled={index===paper.items.length-1} onClick={()=>move(index+1)}>下一题</button><span role="status">{p.service.saveState==='saved'?'已保存':p.service.saveState==='saving'?'保存中':'保存失败，请重试'}</span></div>
    </section>;
}
function Report({p,go,run}:Props){
    const a=p.service.current,paper=p.service.paper;
    if(!a?.score||!paper)return <Empty>交卷后可在此查看报告。</Empty>;
    return <><div class="ef-metrics"><div><strong>{a.score.earnedPoints} / {a.score.totalPoints}</strong>分</div><div><strong>{round(a.score.accuracy*100)}%</strong>题目正确率</div><div><strong>{a.status==='graded'?'已评分':'待人工确认'}</strong>答卷状态</div></div>
        <p>主观题 AI 评分仅供参考，人工确认后才完成评分。</p><div class="ef-actions"><button onClick={()=>download(`${a.id}.json`,JSON.stringify({schemaVersion:1,paper,attempt:a},null,2))}>导出试卷与答卷</button><button onClick={()=>go('wrong')}>查看错题</button></div>
        {paper.items.map(item=>{const q=item.snapshot,s=a.score!.perQuestion.find(s=>s.questionId===q.id)!;return <article><h3>{item.index+1}. {q.stem}</h3><p>{s.earnedPoints} / {s.points} 分 · {s.detail}</p><p>我的作答：{JSON.stringify(a.answers[q.id]?.answer??'未作答')}</p><p>参考答案{hasAiAnswer(q)?'（AI 补充或生成）':''}：{JSON.stringify(q.answer)}</p><p>解析：{q.explanation??'暂无解析'}</p><p>来源：{q.source.type} / {q.source.nature} {q.source.notePath??''}</p>
            <div class="ef-actions"><button onClick={()=>editJson(p.app,'人工改分',{points:s.earnedPoints,reason:''},async value=>{await p.service.adjust(a,q.id,value.points,value.reason);})}>人工改分</button>
            {q.answer.kind==='subjective'&&<button onClick={()=>run(async()=>{const text=a.answers[q.id]?.answer?.text??'';if(!await p.aiConsent('评分内容预览',{question:q,userAnswer:text}))return;const suggestion=await suggestGrade(p.provider,q,text);if(await confirm(p.app,'AI 辅助评分确认',JSON.stringify(suggestion,null,2)))await p.service.adjust(a,q.id,suggestion.suggestedPoints,`AI 辅助，人工确认：${suggestion.reason}`);})}>AI 辅助评分</button>}</div>
        </article>;})}
        {a.score.manualAdjustments.length>0&&<details><summary>改分记录</summary><pre>{JSON.stringify(a.score.manualAdjustments,null,2)}</pre></details>}
    </>;
}
function Wrong({p,run}:Props){
    const [all,setAll]=useState(false),entries=p.service.wrong.filter(w=>all||!w.mastered);
    return <><label class="ef-option"><input type="checkbox" checked={all} onChange={e=>setAll(e.currentTarget.checked)}/>显示已掌握错题</label>
        {!entries.length&&<Empty>暂无待攻克错题。</Empty>}
        {entries.map(w=><article><h3>{w.question?.stem??w.questionId}</h3><p>错误 {w.wrongCount} 次</p><p>{w.question?.explanation??''}</p><button onClick={()=>run(()=>p.service.markMastered(w.questionId,!w.mastered))}>{w.mastered?'重新攻克':'标记已掌握'}</button></article>)}
    </>;
}
function History({p,go,run}:Props){
    const papers=p.repo.papers.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    return <>{!papers.length&&<Empty>还没有生成试卷。</Empty>}{papers.map(paper=>{const attempts=p.repo.attempts.filter(a=>a.paperId===paper.id).slice().reverse();return <article key={paper.id}><h3>{paper.title}</h3><p>{new Date(paper.createdAt).toLocaleString()} · {paper.items.length} 题 · {paper.totalPoints} 分 · {paperModes[paper.mode as keyof typeof paperModes]??'历史试卷'}</p>
        <div class="ef-actions"><button onClick={()=>run(()=>confirm(p.app,'试卷内容',paper.items.map((item,i)=>`${i+1}. ${item.snapshot.stem}`).join('\n\n')))}>查看试卷</button><button onClick={()=>run(async()=>{await p.service.begin(paper);go('exam');})}>开始作答</button><button onClick={()=>run(async()=>{if(await confirm(p.app,'删除试卷',`将删除此试卷及其 ${attempts.length} 份答卷。删除前保留备份；进行中的答卷需先完成或放弃。`))await p.service.deletePaper(paper.id);})}>删除</button></div>
        {attempts.map(a=><p key={a.id}><span>{statusNames[a.status]} {a.score?`${a.score.earnedPoints}/${a.score.totalPoints}`:''} </span><button onClick={()=>run(async()=>{await p.service.resume(a);go(p.service.current?.status==='in_progress'?'exam':'report');})}>查看答卷</button></p>)}
    </article>;})}</>;
}
function Conflicts({p,run}:Props){
    const [files,setFiles]=useState<string[]>([]);
    useEffect(()=>{void Promise.all(['banks','papers','attempts','knowledge','state','config'].map(d=>p.repo.storage.list(p.repo.path(d)))).then(all=>setFiles(all.flat().filter(f=>f.includes('.conflict-'))));},[p, p.repo.attempts,p.repo.banks]);
    return <><p>外部变更时保留原文件和冲突副本。请核对后人工选择；不自动合并。</p>{!files.length&&<Empty>没有冲突副本。</Empty>}{files.map(file=><article><p>{file}</p><button onClick={()=>run(()=>p.resolveConflict(file,'local'))}>保留本地冲突版本</button><button onClick={()=>run(()=>p.resolveConflict(file,'remote'))}>保留远端当前版本</button><button onClick={()=>run(async()=>{const raw=await p.repo.storage.readText(file);download(file.split('/').at(-1)!,raw??'');})}>另存冲突副本</button><button onClick={()=>run(async()=>{await p.app.workspace.openLinkText(file,'',false);})}>打开处理</button></article>)}</>;
}
