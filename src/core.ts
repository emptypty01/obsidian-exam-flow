export const now = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')}`;
export const meta = (prefix: string) => ({id: id(prefix), schemaVersion: 1, createdAt: now(), updatedAt: now()});
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const round = (value: number) => Math.round(value * 100) / 100;
export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function canonicalJson(value:unknown):string {
    return JSON.stringify(value,(_key,current:unknown)=>current&&typeof current==='object'&&!Array.isArray(current)?Object.fromEntries(Object.entries(current).sort(([a],[b])=>a<b?-1:a>b?1:0)):current);
}
export const sameJson=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
export function hash(text: string): string {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
}
export function random(seed: number): () => number {
    return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export class FlowError extends Error {
    constructor(public code: string, message: string) { super(message); }
}
export function errorMessage(error:unknown):string{
    const message=error instanceof Error?error.message:'操作失败，请重试';
    const codes:Record<string,string>={llm_auth:'模型认证失败，请核对 API Key 和服务权限',llm_rate_limit:'模型服务限流，请稍后重试或降低并发',llm_timeout:'模型请求超时，请重试或增加超时时间',llm_network:'模型网络请求失败，请检查网络和 Base URL',llm_invalid_response:'模型响应格式无效，请重试或更换模型',llm_aborted:'AI 请求已取消，可重新发起',llm_server:'模型服务异常，请稍后重试'};
    const code=message.split('：')[0]!;
    return codes[code]??(error instanceof Error&&error.name==='ZodError'?`数据格式校验失败，请核对字段：${message}`:message);
}
