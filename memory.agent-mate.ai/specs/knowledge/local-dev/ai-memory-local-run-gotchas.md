# 本机跑 ai-memory（Apple Silicon / colima）踩坑清单

实测环境：Apple M1 / macOS 26.7 / colima 0.10.3 / ai-memory 0.10.0。

## 1. 官方镜像只有 amd64，但**不要**为此新建 x86_64 虚拟机

`ghcr.io/alphaonedev/ai-memory:0.10.0` 是 **amd64 单架构**（manifest 里只有 `linux/amd64` + attestation）。
直觉做法是 `colima start --arch x86_64`，但 colima 会要求先 `brew install qemu`，代价大。

**默认 aarch64 虚拟机已经注册了 binfmt**，直接指定平台即可：

```bash
docker run --rm --platform linux/amd64 alpine:3.20 uname -m   # → x86_64
```

Apple Silicon 上跑本地验证一律加 `--platform linux/amd64`。

## 2. 配置必须挂到 `$HOME/.config/ai-memory/config.toml`

配置路径由 `$HOME` 推导，**没有任何环境变量能改写**。容器内约定 `HOME=/data`：

```bash
-v "$(pwd)/memory.agent-mate.ai/deploy/config.local.toml:/data/.config/ai-memory/config.toml:ro"
```

挂错位置会被**静默忽略**（tier 退回 `semantic`，不报错、只是能力变弱）。判据：`store` 输出里应出现
`Loaded config from /data/.config/ai-memory/config.toml`，且 doctor 显示 `config_source = "config"`。

## 3. 写入必须关掉 agent attestation

`-e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` —— **可用性前提**。口径按实测：v0.9 不设即拒写（HTTP 面等价出口 `403`）；**v0.10.0 是 surface-scoped**（MCP / CLI 缺省宽松、写入**不报错**）；**v0.11 起缺省翻转为全 surface required** ⇒ 显式写死。判据与证据见 [`../../mcp/mcp-design.md`](../../mcp/mcp-design.md) §9 B3 · [`../upstream-ai-memory/upstream-facts-and-gotchas.md`](../upstream-ai-memory/upstream-facts-and-gotchas.md)。

## 4. CLI 参数形态易错

- `recall` 的 `<CONTEXT>` 是**位置参数**，不是 `--context`（写成 flag 会报 unexpected argument）。
  正确：`ai-memory recall "查询词" -n <namespace>`
- `store` 用 `-n`（namespace）/ `-T`（title）/ `-c`（content）。
- `curator --once --dry-run --json` 的 `auto_tagged` 是验证 `[llm.auto_tag]` 是否真生效的最快信号。

## 5. Bash 里用 `printf` 拼 JSON 会被吃掉转义

```bash
# 错：printf 会把格式串里的 \" 变成 "，请求体变畸形
printf '{"content":"a {\"ok\":true} b"}' "$model"
```

表现是服务端返回 `400 JSON decode error: invalid character 'o' ...`，**看起来像模型不支持
`response_format=json_object`，其实是我方请求体坏了**。用 `python3 -c` + `json.dumps` 生成请求体可根治。

## 6. zsh 下不要把 docker 命令塞进变量

zsh 不对未加引号的变量做分词，`RUN="docker run ..."; $RUN doctor` 会整体当一个命令名。写成函数：

```bash
run() { docker run --rm --platform linux/amd64 ... ghcr.io/alphaonedev/ai-memory:0.10.0 "$@"; }
run doctor
```

## 7. 清理

本地验证用的数据卷（如 `ai_memory_local_data`）用完即删：`docker volume rm ai_memory_local_data`。
