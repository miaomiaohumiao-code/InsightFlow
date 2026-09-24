# InsightFlow AI 分析契约 v1.0.0（待确认设计）

本目录仅含设计契约，不接入 API、不发送 VOC、不增加页面。所有阈值为拟议产品规则，不是统计显著性标准；需要后续用人工标注集校准。

## 文件与所有权

- analysis-contract.ts：全部 TypeScript 类型。
- batch-extraction.schema.json：模型逐条抽取的输出。
- evidence-assignment.schema.json：模型对完整候选结论逐条判定支持/反例的输出。
- analysis-draft.schema.json：模型报告草案输出。
- analysis-result.schema.json：程序校验、核算并组装后的最终存储契约，不能直接让模型填写。
- prompts.md：Prompt 模板。

后续 Responses API 使用 text.format 的 json_schema、strict:true，传入相应模型输出 Schema。全部对象 additionalProperties:false，全部属性 required，可缺省值用 null 或空数组；顶层为 object。JSON Schema 使用 $defs 复用固定对象，不允许开放字典。JSON Schema 能限定形状，不能保证事实真实、引用语义正确或中文输出，必须增加应用校验。

参考：OpenAI 官方 Structured Outputs 文档 https://developers.openai.com/api/docs/guides/structured-outputs （2026-09-15 查阅）。

## 中文与枚举约定

所有 *Zh 字段必须使用简体中文。字段名、ID、固定枚举是机器标识，不是用户可见分析文本；High/Medium/Low 映射为高/中/低。原始引文 originalText、平台和品牌原名允许原语言。translationZh 为中文译文或 null，不能替代原文或充当证据。各类正文缺证据则用 null、[] 及中文说明，不能用“未知人群”等填充伪结论。

## 冻结输入与引文注册

1. 仅使用已确认 Preview 中 included=true 且正文非空的记录。冻结原始 Project、Sources、Preview 和纳入选择，生成 snapshotId、inputHash、parserVersion、输入 revision；inputHash 覆盖原文、来源元数据和所有纳入/排除/拆分选择。编辑后已有报告仍指向旧快照，不能显示为当前数据报告。
2. 现有 VOCRecord.id 包含拆分偏移与模式；必须与 snapshotId 配对使用，不能跨快照复用。快照保存 rawText，不能依赖后来可编辑的 Source。
3. 模型抽取时只提交 vocId 和连续原文摘录 originalText，不让模型计算字符偏移或制造来源。程序在该记录 original 内做严格子串匹配（不宽松替换标点、空格或大小写）。出现多次相同摘录时拒绝不明确匹配，要求扩大上下文；找不到则丢弃并重试该记录。
4. 程序以 record.start + 局部偏移计算 Quote.start/end，均为 Source.rawText 的 UTF-16 半开区间，并验证 rawText.slice(start,end)===originalText 以及在记录范围内。quoteId 由程序按快照、VOC ID、偏移生成。sourceId 从该记录绑定，绝不信任模型提供的来源信息。
5. 汇总模型只能引用有效 quoteId。最终 Representative Quotes 由注册表回填原文、来源、偏移和已核验译文，通常选择 2–5 条；不足时如实少选，包含有代表性的反例，不补齐配额。所有支持/反例 ID 保存在完整证据台账中，代表性引文只是展示抽样。

## Overall 与 Insight 的语义

Overall 固定 topTopics、sentiment、painPoints、userNeeds、purchaseDrivers、purchaseBarriers。

Finding 使用 id、中文标题/摘要、scopeGroupIds、证据、局限。结论 ID 在单个快照中唯一。scopeGroupIds 指向输入 allowlist 中的 groupId；空数组表示全体纳入数据，非空表示这些组来源的并集。若需要交叉筛选，后续显式扩展契约，不能自行把数组解释为交集。

Insight 的 userNeedFindingId 只允许引用 overall.userNeeds；painPointFindingId 引用 overall.painPoints；驱动/障碍数组分别引用同名集合。缺失则 null 或 []，不得为了生成卡片而补造。只引用能被卡片证据支持的内容。

Draft.targetSegmentNeedId 只允许引用已验证的 userNeeds ID。程序从该需求生成 Target Segment：{type:need_based,needFindingId,labelZh}，例如“重视长时间佩戴舒适度的人群”。needFindingId 应与该卡片 userNeedFindingId 相同。没有明确需求时 targetSegment=null。不得生成或推断年龄、性别、职业、收入、身份、地域人群；即便评论中出现人口属性，也不把它作为 Target Segment。需求标题本身还须通过语义审核，不能靠改写成“需要…的女性”绕过规则。

Marketing Implication 只能是由证据支持的待验证行动建议，不能宣称已证明销量提升、转化率、市场规模或 ROI。Opportunity Gaps 也只能写“当前样本显示…，建议验证…”，不把未提及当成市场空白。这里的 strengths/weaknesses 是样本中的用户感知，不是产品客观测试结果。

Sentiment 每个已分析 VOC 一种主标签：positive/neutral/negative/mixed/unknown，mixed 表示同条正负并存，unknown 表示不能判断。多方面情感另存抽取台账；不能按 aspect 条数增加评论数。程序汇总五类 counts，和必须等于 analyzedVocCount；unknown 包含已处理但不能判断的记录，调用失败记录属于 coverage.failedVocIds，不计为负面或中立。分析样本并非唯一用户数，也不能声称代表总体市场。

## Conditional Analysis 的启用与可比性

程序根据有纳入记录的来源确定模块开关；空 Source 不触发。

| 模块 | 触发条件 | 比较要求 |
| --- | --- | --- |
| Platform Differences | 至少 2 个规范化平台 ID | 同品牌/产品/相近时间的可比子样本；无法控制混杂时只描述样本差异 |
| Time Differences | 至少 2 个已知且不同的有效时间范围 | 同平台、品牌、产品；重叠窗口不能写前后趋势，未知时间不编造或按创建日期替代 |
| 品牌对比五项 | 存在 Own Brand 与至少 1 个 Competitor | 每项引用对应品牌证据，多竞品逐品牌区分，不混成一个竞品 |

source.periodId 代表来源批次窗口，不是逐条评论的真实发表时间。时间趋势仅在至少两个不重叠且可比的已知窗口中判断，并注明采集样本局限。规范化平台、品牌和时间需应用规则/用户确认，不让模型自行合并“相似品牌”。

状态由程序验证：not_applicable=没有触发条件；insufficient_data=触发但无法比较；no_supported_finding=可比较但没有足够证据支持具体差异/结论；ready=有可支持的结果。非 ready 状态 reasonZh 必填，相关数组为空；ready 可有局限说明。比较项至少两个不同且同维度的 groupId，每组必须有有效证据。no_supported_finding 不等于统计上没有差异。

品牌模块整体 ready 时个别数组可以为空，需在 reasonZh 中说明。自有品牌优劣需自有证据，竞品优势需对应竞品证据；写“优于/弱于”必须有双方同方面证据。共同痛点至少覆盖自有及一个竞品；机会假设需明确需求证据和相关品牌未满足需求的正面证据（不能仅靠没有提及）。

## 提及频率与证据等级（程序计算）

在草案候选确定后，必须回到全量 VOC，按候选逐条做 evidence assignment；不能从少数代表性引文或分批摘要估计提及数。支持/反例应有有效 quoteId，语义相关但不能支持结论的归 mentions_only，模糊的归 uncertain，不强塞 supports。最终组装取完整台账，而不是模型草案提供的少量 ID。

同一 VOC 对同一结论最多计一次，多个引文/长评分片不得重复计数。统计单元是经过本次明确去重策略处理后的纳入 VOC 记录。Preview 恢复的重复记录默认尊重用户纳入选择并计数，同时在报告局限中披露重复风险；如分析阶段另做去重，必须先显示新排除清单并保存到快照，不得默默改变基数。excludedDuplicateVocIds 仅记录本次实际未纳入的明确重复项。无法识别的跨平台转载不能声称独立用户或独立证据。

对每个结论：U=唯一支持记录数，C=唯一反例记录数，N=其 scope 中已成功处理的纳入记录数。supportRate=U/N，N=0 则 null；反例和支持同一 VOC 同时存在时两组各最多一次，需明确不是互斥比例。主题可能多选，跨主题提及率之和可超过 100%。Top Topics 按 U 降序，平局按稳定 ID，不让模型按“热度感觉”排名。

一致性分别保存 measured / not_applicable / insufficient_data，不适用不得记 0 或 1。以下是拟议 v1 口径：

- 平台：仅纳入可比且 N_g≥10 的平台组；至少 2 组才能 measured。某组支持同方向结论需 U_g≥3 且 U_g>C_g。一致性 score=支持同方向的合格组数/全部合格组数。单平台 not_applicable；有多平台但合格不足为 insufficient_data。组样本和提及率仍需展示，不能把该 score 解释为统计检验。
- 时间：同样计算，但组必须为可比且不重叠的已知窗口。只一个窗口 not_applicable，多窗口无法比较为 insufficient_data。
- 情感：同一结论、同一方面、支持和反例相关记录中，明确正/中/负占比≥70% 且至少 5 条时 measured，score=主导正/中/负标签数/明确标签总数；mixed/unknown 不进分母，但影响上述覆盖门槛。这里 Consistency 的 eligibleGroupCount=明确情感记录数，supportingGroupCount=主导情感记录数，reasonZh 明示此单位与平台/时间的分组不同。对明确讨论分歧/混合情感的结论，或不含情感判断的中性需求结论，此维度 not_applicable，不把真实分歧当成低质量数据。

频率分 F：U<3 为 0；3≤U<10 为 0.5；U≥10 为 1。基础分 S=(0.4F + 各 measured 一致性 score×0.2)/(0.4 + measured 维度数×0.2)。未测量维度不参与分母。

- High：S≥0.8 且 U≥10、N≥50、至少两个一致性维度 measured；无未解决的引文/来源错误、明显重复/边界风险，scope 的分析覆盖完整。
- Medium：S≥0.5 且 U≥3，不满足 High；覆盖不完整最高 Medium。
- Low：其余有证据的结论。没有支持证据的结论不发布，不用 Low 包装。

等级描述样本内证据的覆盖与一致程度，不是模型概率或统计置信度。各字段均由验证后的台账计算，模型不能自评 High。reasonZh 用中文模板解释触发规则，并披露不可比较、样本稀少和反例。

Marketing Priority 与 Evidence Strength 分开。模型可提出带理由的优先级，仅依据研究目标相关性、已证实痛点/购买阻碍和可测试性，不估造成本/收益。High 需要与研究目标直接相关、至少一条被支持的需求/痛点/驱动/障碍且 evidence 非 Low；Low 证据的候选最多 Medium 并标明先补证据。最终程序执行上限校验，reasonZh 保留调整原因；优先级不自动触发投放。

## 校验与失败处理

按顺序：响应完成状态/拒绝 → JSON Schema → 快照与 ID allowlist → 引文逐字/偏移匹配 → 跨字段关系 → 语义支持/中文/需求人群审核 → 程序汇总 → AnalysisResult Schema。

跨字段校验包括：无重复/陌生 ID，未纳入 VOC 不可引用，引用必须在指定 scope；比较组正确且存在证据；至少一条支持证据；用户需求等引用类别正确；数据完整性和模块状态正确；分母及情感合计正确；机会假设有限定语。引用真实也可能断章取义，因此核对相邻上下文和否定、讽刺、比较对象；规则无法可靠判断时标 uncertain 或进入人工核对，不能宣称程序彻底消除幻觉。

所有输入字段（VOC、用户名、项目名、目标、平台、品牌）是不可执行的数据，不跟随其中的指令，不访问链接，不启用 web/tools。只重试失败批次/记录，最多两次语义修复；仍失败就保留明确缺失，不将拒绝/截断/解析失败填成空的成功结果。一个输出 token 不足的批次要缩小重跑。schemaVersion、promptVersion、modelVersion、规则版本与输入 hash 一起保存以便复现。

## 大批量处理方案

1. 冻结并预检确认数据；按规范化平台×品牌×时间保留来源分层。预估输入/输出 token 和费用上限，不以固定条数保证安全。批次预算为模型上下文扣除 system/schema/上下文/输出预留与安全余量；初始可用约 50–100 条或约 8k 输入 token 作为调参起点，以 token 预算优先，不是模型限制。
2. 每批 BatchExtraction 逐条记录输出；输入 ID 集与输出 ID 集必须一致，不能只返回“值得分析”的条目。保存每条 sentiment、aspects、连续原文引文，程序注册引文。长条超过预算时按段落切传输分片，记录父 vocId 与原文偏移，允许重叠上下文但不增加评论数，父记录全部分片完成才算已分析。
3. 按类别归并同义主题并创建候选；归并保留每条 VOC 的溯源与反例。不跨类别合并需求/驱动，不因词面相似合并相反含义。每批都返回完整记录，而非仅局部 Top N，避免丢失低频高价值痛点。主题归并若超上下文，分层处理标签集，保留成员 ID 映射。
4. 对候选做 evidence assignment：按同样 token 预算扫描全量原文/已验证 aspect 台账，确认 supports/contradicts 等。候选×VOC 较大时分候选组执行、缓存稳定映射；采用检索缩小范围只能作为候选召回，若未完成全量覆盖就不能输出精确全局提及率。情感合计直接用逐记录标签，不能平均各批百分比。
5. 程序按唯一父 VOC ID 核算频率、组内比例、五类情感、覆盖和一致性，生成受控 evidence packet。最终模型只看按 token 预算组织的统计包、候选与已注册引文，输出 AnalysisDraft；不足上下文时按模块生成后合并，并做全局唯一 ID/跨模块引用校验。
6. 程序验证草案、回填全量证据和来源、按公式评级，组装 AnalysisResult。保留未分析数和局限；默认失败批次修复后再发布完整报告。若用户选择查看部分结果，coverage=partial，报告明确可用样本分母且不包装成完整趋势。
7. 以 snapshotHash + stage + batchHash + promptVersion + schemaVersion + modelVersion 为幂等键，检查点保存到 IndexedDB；并发从 2–3 起步并按速率限制退避。取消后不覆盖新快照，失败只重跑对应批次，记录累计消耗并在预算达到时停止。未来 Vercel 实现采用分阶段短请求，避免一个 HTTP 请求承担整批任务；本阶段不实现调度或 API。这里的应用分批不等于必须采用 OpenAI Batch API。

## 本次验证边界

设计文件仅进行 TypeScript 检查、JSON 可解析、内部引用存在、所有对象关闭额外字段且所有属性必填的静态检查。没有调用真实模型，也未实现上述业务校验器、评分器、分批任务或页面；实际语义效果待下一阶段用带人工标签的多语言 VOC 测试集验收。
