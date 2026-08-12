# 复盘 2026-07-31 — 事故与成本反思（Collect）

> 当日是过去一周里 cost 最高的一天，且多次"修好一个又弄坏一个"。本文为详细复盘，镜像存于仓库记忆 `/memories/repo/retrospective-2026-07-31.md`，简明教训见 `/memories/engineering-lessons.md`。

## 一、事故时间线

1. **事故 A — `.collect-backup` 明文备份**（最严重）：加密管线稳定性治理时引入 `SafeFileIO.WriteAllBytesWithBackup`，在内容加密/解密前把原文件复制成 `<name>.collect-backup` 侧车。用户发现：**加密库里这些备份 = 加密前的明文原图 + 明文文件名**，直接废掉内容加密和文件名加密，且目录体积翻倍。最终彻底删除备份机制，全部改 `WriteAllBytesAtomic`。
2. **事故 B — 缩略图 head-read 回归**：为加 magic 日志，在 `ThumbnailService` 明文分支先 `input.Read(head,0,12)` 再 `SKBitmap.Decode(input)`，**流位置前移 12 字节 → PNG 头被截断 → 所有普通库缩略图 decode=null → 全挂 404**。
3. **事故 C — 错误诊断（超长文件名）**：把用户"check path"报错归因为超长文件名，但那是基于我自造的 212 字符测试目录，**没看用户真实目录**。用户质疑"真的是超长文件名吗？"后核查——真实库最长文件名仅 44 字符，判断错误，浪费多轮。
4. **事故 D — EncryptFileNames 被丢弃**：实现"既有未加密库 + 密码 → 升级为加密库"时，只写了 `IsEncrypted/Salt/Hash`，漏掉 `EncryptFileNames` → 用户勾选的文件名加密静默失效。
5. **事故 E — 创建加密库 "check path" 反复**：多轮复现才定位到根因是 `ScanFilesSync` **逐文件无 try/catch，一个坏文件让整库 scan 500**，前端弹误导性的"check path"。
6. **成本放大器**：工具被禁用时反复重试；每轮 bug 都要求用户 rebuild+restart 验证；多次重复读同一文件、重复复现；没有第一时间请用户协助验证。

## 二、根因

- 加日志时破坏了被观测的流/解码路径（事故 B），且加完日志没有验证行为不变。
- 在加密存储里落明文/密文副本，安全模型被自己的实现打穿（事故 A）。
- 用合成数据而非真实数据下结论（事故 C）。
- 大特性（文件名加密）分层叠加在"文件名驱动"的脆弱不变量上，未全链路追踪所有路径：scan/rename/move/categorize/rename-category/delete-category/upload/thumbnail 加密态（事故 D/E）。
- 验证只到"编译通过"，没有做测试库端到端往返（加密→解锁→浏览→解密）就交付，把验证成本转嫁给用户。
- 用户给出的日志与质疑（正确的关键线索）没有第一时间采纳；用户是可开发、可验证的人，我却没有请他协助。

## 三、预防规则（必须遵守）

1. **加日志不得改变被观测代码的行为**：对 Stream 的读取（magic head 等）必须用独立 buffer 或先回卷 `Position=0`，再交给解码器；加完日志必须验证解码/行为不变。
2. **加密存储中绝不落明文/密文副本**：任何中间态只在内存；`WriteAllBytesAtomic`（temp+rename）已保证"失败不截断原文件"，不需要任何备份文件。
3. **诊断先用真实数据**：列目录、量真实文件名长度、读实际内容，再理论化；合成 repro 只能作为第二步验证，不能作为结论依据。被用户质疑时先核查，不辩护。
4. **跨层/大特性实施前完整映射调用面**：列出所有依赖同一不变量的代码路径（尤其文件名驱动的标签模型：扫描/改标签/移动/分类/重命名分类/删除分类/上传/缩略图加密态），改一处必须同步所有相关路径。
5. **交付前做端到端验证**：测试库完整往返（加密→解锁→列表/缩略图→改标签→解密→文件名/修改时间恢复）通过后才算完成，不能只编译通过。
6. **工具被禁用 = 主动请求授权**：不要反复重试；明确请用户"启用/授权 X 工具"后再继续，避免反复失败浪费成本。
7. **采纳用户提供的日志/现象**：用户给的日志就是根因证据，先顺着它查，不要先讲自己的假设。
8. **借助用户的开发能力**：用户是有开发能力的人；当我难以测试/复现（无法跑 UI、够不到真实环境、无法确定性复现）时，主动请用户看一眼或帮忙复现，把用户当作高效的验证资源，不要自己空转。

## 四、已落地的对应修复（同日）

- 删除 `WriteAllBytesWithBackup` + `RetryOnIOException`；`EncryptFileOnDisk`/`DecryptLibraryAsync` 全走 `WriteAllBytesAtomic`；`ScanAsync` 加 `CleanupOrphanedBackups` 清理存量。
- `ThumbnailService` 明文分支解码前 `input.Position = 0`。
- `ScanFilesSync` 逐文件 try/catch（单个坏文件只跳过+日志）。
- `InitializeAsync` 升级路径补设 `EncryptFileNames`（后改为"有密码即恒 true"，移除 UI 开关）。
- `GetThumbnail` 对明文缩略图就地重加密自愈。
- `EncryptLibraryAsync`/`DecryptLibraryAsync` 末尾 `EncryptAllThumbnails`/`DecryptAllThumbnails`（缩略图随库加解密）。
- `SafeFileIO.WriteAllBytesAtomic` 保留原文件 LastWriteTimeUtc（修改时间排序不受影响）。

## 五、协作约定（与用户）

- 用户 = 有开发能力的协作者，不是黑盒验收方。
- 我无法测试/复现时 → 直接请用户帮忙看一眼或复现，而不是无限猜测。
- 工具被禁用 → 直接向用户请求授权，而不是反复重试。
- 我提出假设被质疑 → 先核查真实数据，再回应。
