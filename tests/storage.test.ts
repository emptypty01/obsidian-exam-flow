import {expect,test} from 'vitest';
import {Storage, type Adapter} from '../src/data/storage';
import {memoryAdapter} from './fixtures/memory';
test('外部修改产生冲突副本并保留原文件', async () => {
    const adapter = memoryAdapter(), first = new Storage(adapter,'device1'), second = new Storage(adapter,'device2');
    await first.writeJson('data/a.json',{schemaVersion:1,value:1});
    await second.readJson('data/a.json');
    await first.writeJson('data/a.json',{schemaVersion:1,value:2});
    await expect(second.writeJson('data/a.json',{schemaVersion:1,value:3})).rejects.toThrow('冲突');
    expect(await first.readJson('data/a.json')).toEqual({schemaVersion:1,value:2});
    expect((await adapter.list('data')).files.some(f => f.includes('.conflict-'))).toBe(true);
});
test('无原子更新能力时拒绝覆盖已有文件，保留原文和待写临时内容',async()=>{
    const adapter=memoryAdapter();delete adapter.process;
    const storage=new Storage(adapter,'one');await storage.writeJson('data/a.json',{schemaVersion:1,value:1});
    await expect(storage.writeJson('data/a.json',{schemaVersion:1,value:2})).rejects.toThrow('原文件未修改');
    expect(await storage.readJson('data/a.json')).toEqual({schemaVersion:1,value:1});
    expect((await adapter.list('data')).files.some(f=>f.includes('.tmp-'))).toBe(true);
});
test('损坏 JSON 保留副本并报错，不删除原文',async()=>{
    const adapter=memoryAdapter();await adapter.write('data/a.json','{坏');const storage=new Storage(adapter,'one');
    await expect(storage.readJson('data/a.json')).rejects.toThrow('损坏');expect(await adapter.read('data/a.json')).toBe('{坏');
});
