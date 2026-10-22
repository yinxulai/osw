# proxy/

代理与请求：一次请求进入本地服务后怎么被识别、筛选、透传、切换与改写。

各文档的覆盖范围与权威归属见 [`../README.md`](../README.md) 的文档地图。

- [proxy.md](./proxy.md) — 对外行为契约：候选过滤、自动切换、流式边界、超时
- [proxy-engine.md](./proxy-engine.md) — 引擎内部分层、透传内核、观察/修改扩展点
- [protocol-conversion.md](./protocol-conversion.md) — 跨协议转换开关、矩阵与失败语义
- [request-rewrite-rules.md](./request-rewrite-rules.md) — 重写规则链的执行语义
- [outbound-proxy.md](./outbound-proxy.md) — 上游出站代理模式、绕过规则、连接测试
