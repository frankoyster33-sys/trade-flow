# 现有技能与本系统的关系

- 内部核算规则、模板与生成器：原有 `polybag-batch-quotation` 技能，规则版本 2026-09-06。
- 对外报价单生成器、纸箱计算与公司资料：原有 `generate-commercial-quotation` 技能。
- 本系统复制并固定了上述规则和模板到 vendor，未修改已安装技能及其主模板。内部生成器改为可调用函数，增加来源页、报价资料页和保存版本识别。
- 所有 Excel 创建和编辑使用工作区提供的 `@oai/artifact-tool`。openpyxl 仅用于独立读取保存后的原始单元格，处理 WPS 空字符串兼容问题；不保存或改写源文件。
- 硅基流动接口使用官方 `/v1/chat/completions` 与 `/v1/models`，模型选择基于账户返回的模型列表。
- UI 延续已确认的 MUJI 风格原型；主色 Greenery #88B04B。Lucide 图标许可证见 public/lucide.LICENSE。

系统构思与设计署名可由用户在设置中填写。此页面记录设计与开发来源。
