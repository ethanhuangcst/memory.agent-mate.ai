# ADR-007: qwen 走私有 MaaS 端点，嵌入模型与维度一律实测确定

## Status
Accepted

## Context
ai-memory 的 `smart` 档依赖三类模型能力：对话（`[llm].model`）、结构化/JSON（`[llm.auto_tag].model`）、嵌入（`[embeddings].model`）。

三个问题压在一起：

1. 上游 `qwen` 别名的默认端点是**公网** `https://dashscope.aliyuncs.com/compatible-mode/v1`，而本项目持有的是**私有 MaaS workspace 级 key**（`llm-<workspace>.<region>.maas.aliyuncs.com`）——workspace key 在公网端点不通。
2. `[embeddings].dim` **无法推断**：上游 `KNOWN_EMBEDDING_DIMS` 表不含任何 qwen 模型，未命中且未设 dim 会**静默**回落到 tier preset 的 768；而 dim 一旦写死即绑定到已写入的向量，猜错要重跑 `reembed` 回填。
3. 本机 secrets 里**根本没有 embedding 模型**，且 `QWEN_CHAT_MODEL_FALLBACK=qwen-flash / qwen-turbo` 是含斜杠的非法值。

叠加一个不可从文档推定的事实：该端点 host 形如 `llm-*`，却同时提供 embeddings 能力——只能实测。

## Decision

1. **本地与生产都用私有 MaaS 端点**：通过 `[llm].base_url` 与 `[embeddings].base_url` 显式覆盖（上游源码确认二者为合法字段；`[embeddings]` 另有同义字段 `url`，`base_url` 优先）。
2. **模型定为**：

   | 用途 | 配置位 | 取值 | 实测结论 |
   | --- | --- | --- | --- |
   | 对话 | `[llm].model` | `qwen-plus` | chat OK |
   | 对话降级 | （产品侧 env） | `qwen-flash` | chat OK |
   | 结构化 / JSON | `[llm.auto_tag].model` | `qwen-turbo` | chat OK，且 `response_format=json_object` OK |
   | 嵌入 | `[embeddings].model` | `qwen3.7-text-embedding` | 可用，**dim = 1024** |
   | 嵌入备选 | 同上 | `qwen3.7-text-embedding-flash` | 可用，同为 1024 维 |

   `[llm.auto_tag]` **只写 `model`，绝不写 `backend`**（写 `ollama` 会在无 Ollama 的机器上静默打挂 auto_tag / 查询扩展 / 矛盾检测）。
3. **维度一律实测**：新增 `memory.agent-mate.ai/scripts/qwen-verify.sh`，探测端点 `/models` → 真实 chat → `json_object` → embeddings，并以响应向量长度作为 `dim`。
4. **本地部署**新建 gitignored 的 `memory.agent-mate.ai/deploy/.env.local` + `config.local.toml`；生产侧 `config.toml.tmpl` 保持同结构、端点用占位符 `<QWEN_BASE_URL>`。
5. **脱敏延申**：MaaS 主机名含 workspace 标识，与公网 IP 同属可被探测的信息 —— 被跟踪文件一律写 `<QWEN_BASE_URL>`，`secret-check.sh` 增加通用模式 `*.maas.aliyuncs.com` 拦截。

## Rationale

- 不覆盖 `base_url` 会打到公网端点并直接鉴权失败（**响亮**，但浪费排查时间）；workspace key 设计上就是端点绑定的。
- dim 不能猜：错值**不报错**，只让召回质量静默劣化，且换值需重跑回填。
- 端点能力必须从实测取得：host 名像是「只做 LLM」却同时提供 embeddings，`/models` 探测 + 真实调用是最省事且可复核的方式。
- 模型设置集中到 config：`dim` **不存在任何环境变量**；若部分走 env、部分走 config，会落入「配置文件看起来对、实际被 env 静默覆盖」的排查陷阱（耦合面 B5）。
- 护栏用**通用后缀**而非具体 workspace 值 —— 检查器自身不成为泄露源（延续 ADR-006 的纪律）。同理，护栏自身的注释里也不能写真实形态的主机名，否则会命中自己。

## Consequences

- 生产部署时 `config.toml` 必须把 `<QWEN_BASE_URL>` 替换为真实端点，否则启动即失败（响亮，可接受）。
- 换嵌入模型必须重跑 `ai-memory reembed` 回填；**同为 1024 维不等于向量可比**（flash 版亦然）。
- 本地运行 ai-memory 需 Docker（官方镜像为 **amd64**；Apple Silicon 走 `--platform linux/amd64`），且配置必须挂到 `$HOME/.config/ai-memory/config.toml`（路径由 `$HOME` 推导，无 env 可改写）。
- `qwen-verify.sh` 成为模型可用性的可重复探针 —— 升级上游或换模型后应重跑。

## Date
2026-09-20
