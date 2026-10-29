import {expect,test} from 'vitest';
import {CompatibleProvider} from '../src/ai/provider';
import {draftQuestions} from '../src/ai/tasks';
import {seedExam} from '../src/seed';
test('401 不重试，429 重试，取消不调用网络',async()=>{
    let calls=0;
    const p=new CompatibleProvider({baseUrl:'https://example.test/v1',model:'mock',timeoutMs:100,maxRetries:1,concurrency:2},()=> 'secret',async()=>{calls++;return {status:calls===1?429:200,json:{choices:[{message:{content:'ok'}}]}};},async()=>{});
    expect((await p.chat({messages:[]})).content).toBe('ok');expect(calls).toBe(2);
    const auth=new CompatibleProvider(p.settings,()=> 'secret',async()=>({status:401,json:{}}));
    await expect(auth.chat({messages:[]})).rejects.toThrow('llm_auth');
    const controller=new AbortController();controller.abort();
    await expect(p.chat({messages:[]},controller.signal)).rejects.toThrow('llm_aborted');expect(calls).toBe(2);
});
test('无引用材料拒绝 AI 出题',async()=>{
    await expect(draftQuestions({id:'mock',chat:async()=>{throw new Error('不得联网');}},'生成题目',[],seedExam,'subj_comprehensive',[])).rejects.toThrow('材料');
});
test('流式错误回退非流式，取消正在执行的请求',async()=>{
    let fallback=false;
    const p=new CompatibleProvider({baseUrl:'https://example.test/v1',model:'mock',timeoutMs:1000,maxRetries:0,concurrency:1},()=> 'secret',async(_u,_h,_b,_s,delta)=>{if(delta)throw new TypeError('CORS');return {status:200,json:{choices:[{message:{content:'fallback'}}]}};});
    p.onFallback=()=>{fallback=true;};
    expect((await p.chatStream({messages:[]},new AbortController().signal,()=>{})).content).toBe('fallback');expect(fallback).toBe(true);
    const controller=new AbortController();
    const pending=new CompatibleProvider(p.settings,()=> 'secret',async()=>{controller.abort();return new Promise(()=>{});});
    await expect(pending.chat({messages:[]},controller.signal)).rejects.toThrow('llm_aborted');
});
