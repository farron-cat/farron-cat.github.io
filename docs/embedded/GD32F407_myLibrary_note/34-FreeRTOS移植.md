# 34 · FreeRTOS 移植（GD32F407 / ARM_CM4F + heap_4）· 学习笔记

> 这一篇讲 **4 次提交**：`09acacc`（把 FreeRTOS 内核搬进工程）→ `343361a`（**修复移植后上电卡死：µs 延时从 DWT 改成 TIMER6**）→ `c2580e2`（动态创建任务）→ `3800637`（**合并 FreeRTOS + 裸机多任务两条线**）→ `d8c845a`（README 重写 + 配置整理）。
> 它是第 33 篇的**下一站**：33 讲"自己写一个任务调度器"，这一篇讲"**换成真正的 RTOS 要动哪些地方、会踩什么坑**"。
> 整理日期：2026-10-21　｜　提交范围：`09acacc`、`343361a`、`c2580e2`、`3800637`、`d8c845a`

---

## 怎么读这份笔记

| 你的情况 | 直接跳 |
| --- | --- |
| **刚移植完 RTOS，上电就卡死** | ★ **第五章**（本工程真实踩过，完整排障链 + 修法） |
| 想知道移植到底要改哪几处 | 第三章那 5 个步骤 + 第四章（`SYS_SUPPORT_OS` 宏） |
| 想知道 `FreeRTOSConfig.h` 每个值什么意思 | 2.4 节逐项表 |
| 想搞懂为什么必须改优先级分组 | **3.5 节**（`BASEPRI` 只比抢占优先级） |
| 想知道 `xTaskCreate` 六个参数 | 第六章 |
| 卡住了 | 第八章排查清单；再看 `../GD32F407_myLibrary/Doc/FreeRTOS移植后卡死问题与修复.md` |

> **一个前提说明**：本工程的教材快照（`ARM/NOTE/Textbook/`）里**没有 FreeRTOS 章节**
> （教材目录里有"FreeRTOS嵌入式操作系统 / 任务管理"这几个标题，但没导出对应文件）。
> 所以本篇的依据是：**FreeRTOS 官方源码（工程内 `Middleware/FreeRTOS/`）+ `FreeRTOSConfig.h` + 工程内那份排障文档**。

---

## 知识点地图

```
34 FreeRTOS 移植
├── 一、为什么要换（承接 33 篇的 6 条局限）
├── 二、FreeRTOS 在工程里的组成
│   ├── 2.1 四个部分（core / portable / MemMang / config）
│   ├── 2.2 实际只编译 9 个 .c
│   ├── 2.3 heap_4：为什么选它
│   └── 2.4 ★ FreeRTOSConfig.h 逐项（16 个关键值）
├── 三、移植的 5 个步骤
│   ├── 3.1 拷源码
│   ├── 3.2 写 config
│   ├── 3.3 加编译项（core 7 + port 2）
│   ├── 3.4 ★ 异常映射：必须删掉自己的 SVC/PendSV/SysTick
│   └── 3.5 ★ 优先级分组：PRE2_SUB2 → PRE4_SUB0
├── 四、SYS_SUPPORT_OS：一个宏管两个文件（裸机/RTOS 双模式）
├── 五、★★ 移植后上电卡死：完整排障链（DWT → TIMER6）
│   ├── 5.1 现象
│   ├── 5.2 五步缩小范围
│   ├── 5.3 根因
│   ├── 5.4 修法
│   └── 5.5 为什么选 TIMER6
├── 六、任务创建：xTaskCreate 六个参数
├── 七、vTaskStartScheduler() 之后
├── 八、遗留问题与隐患
├── 九、参数速查表 / 排查清单
└── 十、自测题 + 练习题
```

---

## 学习目标

1. FreeRTOS 内核文件有 343 个，**实际编译几个**？为什么其余的不编？
2. `FreeRTOSConfig.h` 里 `configTICK_RATE_HZ = 1000` 意味着什么？和裸机的 SysTick 1 MHz 有什么冲突？
3. **为什么必须删掉工程里原来的 `SVC_Handler` / `PendSV_Handler` / `SysTick_Handler`？** 不删会怎样？
4. **为什么优先级分组要从 `PRE2_SUB2` 改成 `PRE4_SUB0`？**
5. **DWT 为什么不可靠？TIMER6 方案好在哪里？**
6. `heap_4` 和 `heap_1/2/3/5` 有什么区别？
7. `xTaskCreate` 的栈参数单位是什么？`128` 是多少字节？

---

## 一、为什么要换（承接 33 篇）

第 33 篇的裸机任务表已经能跑 6 个任务了。但它在结构上有 **6 条局限**：

| 局限 | 具体表现 |
| --- | --- |
| 不能抢占 | 一个任务跑 30 ms，后面全等 |
| 没有优先级 | 按键和刷屏同权 |
| 长任务拖垮全表 | 串口打印 2 ms 就足以让整表延后 |
| 没有同步机制 | 两个任务共用 I2C/SPI 只能靠"中断只置标志"手工约定 |
| 任务表编译期固定 | 不能运行时加任务 |
| 没有栈隔离 | 一个任务栈溢出就踩坏别人 |

**FreeRTOS 正好提供这 6 样东西**（对应关系见 33 篇第五章）。

> **但要注意**：**上 RTOS 不是"免费的升级"**。它的代价是：
>
> | 代价 | 数量级 |
> | --- | --- |
> | **代码体积** | 内核 ~29 KB Code（本工程 Program Size：Code=28904，含内核） |
> | **RAM** | `configTOTAL_HEAP_SIZE = 75 KB`（占 192 KB 的 39%） |
> | **每次任务切换** | ~1~2 µs（保存/恢复 16 个寄存器 + 浮点上下文） |
> | **学习成本** | 至少要吃透"任务状态 / 优先级 / 临界区 / 信号量"四个概念 |
>
> **所以本工程的节奏是对的**：**先自己写一遍任务表（33），确认"确实需要抢占和同步"，再上 RTOS（34）。**

---

## 二、FreeRTOS 在工程里的组成

### 2.1 四个部分

```
Middleware/FreeRTOS/                      343 个文件（官方完整包）
├── include/                              所有头文件（FreeRTOS.h / task.h / queue.h / semphr.h …）
├── *.c                                   内核源文件（tasks.c / queue.c / list.c / timers.c …）
├── FreeRTOSConfig.h                      ★ 唯一需要你写的文件
└── portable/                             ★ 移植层（按"编译器+内核"分目录）
    ├── GCC/ARM_CM4F/port.c               ← 本工程实际编译这个
    ├── RVDS/ARM_CM4F/port.c              ← Keil 官方推荐的另一个版本（本工程没编）
    ├── GCC/ARM7_*、GCC/ARM_AARCH64/…      ← 其他架构（全部没编）
    └── MemMang/heap_1.c ~ heap_5.c       ← 5 种内存管理方案，选 1 个
```

> **"343 个文件"里绝大多数是"别人的平台"**。FreeRTOS 官方压缩包是"全家桶"，
> **真正编进固件的只有 9 个 `.c`**（下一节）。这也是 README 里那条遗留问题的来源：
> *"`portable/` 未精简 —— 官方全部移植目录都在仓库内，实际只编译 `GCC/ARM_CM4F` + `MemMang/heap_4.c`"*。

### 2.2 实际只编译 9 个 `.c`

`.eide/eide.yml` 里分了两组：

| 组 | 文件 | 作用 |
| --- | --- | --- |
| **`FreeRTOS_core`**（7 个） | `tasks.c` | ★ 任务调度核心（创建/删除/切换/延时） |
| | `queue.c` | 队列（信号量底层就是队列） |
| | `list.c` | 链表（就绪表/延时表的基础） |
| | `timers.c` | 软件定时器 |
| | `event_groups.c` | 事件组 |
| | `stream_buffer.c` | 流缓冲/消息缓冲 |
| | `croutine.c` | 协程（**本工程 `configUSE_CO_ROUTINES = 0`，编了但没用**） |
| **`FreeRTOS_port`**（2 个） | `portable/GCC/ARM_CM4F/port.c` | **移植层**：上下文切换、启动第一个任务、SysTick 处理 |
| | `portable/MemMang/heap_4.c` | **堆管理**：`pvPortMalloc` / `vPortFree` 的实现 |

**`port.c` 才是"移植"两个字的真正含义** —— 它负责三件和硬件强相关的事：

| 函数 | 干什么 |
| --- | --- |
| `vPortSVCHandler`（→ `SVC_Handler`） | **启动第一个任务**：从任务栈里恢复寄存器，跳到任务函数 |
| `xPortPendSVHandler`（→ `PendSV_Handler`） | ★ **任务切换本体**：保存当前任务上下文、恢复下一个任务上下文 |
| `xPortSysTickHandler`（→ `SysTick_Handler`） | 每次 tick 检查"有没有任务该唤醒/该抢占" |

> **★ "移植"的工作量 90% 就在 `port.c` 里那几百行汇编。**
> 而因为它按"编译器 + 内核"分目录，**选对目录就等于完成了大半移植**：
>
> | 选项 | 说明 |
> | --- | --- |
> | `GCC/ARM_CM4F` | GCC 风格（`__attribute__((naked))` + 内联汇编），**本工程选这个** |
> | `RVDS/ARM_CM4F` | Keil 自家编译器（ARMCC/armclang）风格 |
>
> 本工程用 **Keil AC6（armclang）** 编译，却选了 **GCC 版本** —— README 的说明是 *"（浮点上下文保存，AC6 亦可编译）"*。
> 事实是 **armclang 兼容 GCC 的内联汇编语法，所以能编过**；
> **但官方文档推荐 AC6 用 `RVDS` 版** —— 这属于"能跑但不标准"的选择，记在这里备查。

### 2.3 `heap_4`：为什么选它

FreeRTOS 提供 5 种内存管理，**选哪个只影响 `pvPortMalloc` 的实现**：

| 方案 | 做法 | 能 `free` 吗 | 碎片 | 适合 |
| --- | --- | --- | --- | --- |
| `heap_1` | 只分配不释放 | ❌ | —— | 任务只创建不删除的极简系统 |
| `heap_2` | 分配 + 释放，但**不合并相邻空闲块** | ✅ | 会碎 | 老版本，已被 heap_4 取代 |
| `heap_3` | 直接包 `malloc/free`（要开 `configUSE_NEWLIB_REENTRANT`） | ✅ | 看 C 库 | 想用标准库的堆 |
| **`heap_4`** | 分配 + 释放 + **相邻空闲块合并** | ✅ | **少** | ★ **最通用**，本工程选它 |
| `heap_5` | 同 heap_4，且**支持多块不连续内存** | ✅ | 少 | 有 CCM/SDRAM 等多块 RAM |

**`heap_4` 的两个关键特性**：

```
① 空闲块链表 + 首次适配（first fit）
② 释放时把"相邻的空闲块"合并成一块  ← 这条是它比 heap_2 强的核心
```

**本工程的配置**：

```c
#define configTOTAL_HEAP_SIZE  ((size_t)(75 * 1024))    // 75 KB
```

| 事实 | 数值 |
| --- | --- |
| 芯片 RAM | 192 KB（SRAM0 112 + SRAM1 16 + CCM 64） |
| 堆大小 | **75 KB** |
| 整个固件的 ZI-data | **79560 B ≈ 77.7 KB**（其中 75 KB 就是这块堆） |
| 已用的任务栈 | `app_task` 512 words = **2 KB**；测试任务 128 words = 512 B ×3；`task_keys_scan` 64 words = 256 B |
| **剩余堆** | 约 **75 − 4.3 ≈ 70 KB**（还有 idle 任务、timer 任务、TCB、队列） |

> **`heap_4` 的坑：它是一块静态数组**（`ucHeap[configTOTAL_HEAP_SIZE]`），
> **在链接时就占满 75 KB 的 ZI** —— 不管你有没有用完。
> 所以"堆开大一点保险"是错的：**开大了直接吃光 RAM**。
> 本工程 75 KB 已经是 192 KB 的 39%，**再往上加就要算账了**。

### 2.4 ★ `FreeRTOSConfig.h` 逐项

**这是移植时唯一必须自己写的文件**。本工程的关键 16 项：

| 宏 | 值 | 含义 | 为什么这么设 |
| --- | --- | --- | --- |
| `configUSE_PREEMPTION` | **1** | **抢占式调度** | 高优先级任务就绪立刻抢占（33 篇局限 #1 的答案） |
| `configUSE_TICK_HOOK` | **1** | 开启 tick 钩子 | ★ **本工程的"1 ms 扫描"全靠它**（第 4 章） |
| `configCPU_CLOCK_HZ` | `SystemCoreClock` | CPU 主频 | 168 MHz（tick 计算用） |
| **`configTICK_RATE_HZ`** | **1000** | **每秒 1000 个 tick → 1 tick = 1 ms** | 与裸机 SysTick 的 1 ms 扫描节拍对齐 |
| `configMAX_PRIORITIES` | **5** | 优先级 0~4 | 够用即可；越小 RAM 越省（就绪表数组） |
| `configMINIMAL_STACK_SIZE` | **130 words** | idle 任务的栈 = **520 B** | 官方建议 ≥ 128 |
| **`configTOTAL_HEAP_SIZE`** | **75 KB** | heap_4 的大小 | 见 2.3 |
| `configMAX_TASK_NAME_LEN` | 10 | 任务名最长 10 字符 | `"app"`、`"task_keys_scan"`（15 字符 → **被截断**！） |
| `configUSE_MUTEXES` | **1** | 开互斥量 | 第 35 篇的互斥量测试要用 |
| `configUSE_RECURSIVE_MUTEXES` | 1 | 开递归互斥量 | 同一个任务可重复 take |
| `configUSE_COUNTING_SEMAPHORES` | **1** | 开计数信号量 | 第 35 篇 |
| `configUSE_TIMERS` | **1** | 开软件定时器 | 第 35 篇 |
| `configTIMER_TASK_PRIORITY` | 2 | 定时器服务任务优先级 | 要比普通任务高，才不会被"饿死" |
| `configUSE_TRACE_FACILITY` | 1 | 开调试追踪 | 可以用 `uxTaskGetSystemState()` 看任务列表 |
| **`configCHECK_FOR_STACK_OVERFLOW`** | **0** | ⚠️ **栈溢出检查关闭** | 省资源，但**溢出时不会有任何提示**（遗留 #8） |
| `configUSE_MALLOC_FAILED_HOOK` | 0 | ⚠️ 堆分配失败不回调 | `xTaskCreate` 返回 `errCOULD_NOT_ALLOCATE_REQUIRED_MEMORY`，但没人看 |

**还有 3 组"中断优先级"的宏（★ 这是最容易出事的一组）**：

```c
#define configPRIO_BITS   __NVIC_PRIO_BITS                 // = 4（Cortex-M4 有 4 位优先级）
#define configLIBRARY_LOWEST_INTERRUPT_PRIORITY         0xf   // 最低优先级 = 15
#define configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY    5     // ★ 能调 API 的最高优先级

#define configKERNEL_INTERRUPT_PRIORITY        (0xf << 4) = 0xF0
#define configMAX_SYSCALL_INTERRUPT_PRIORITY   (5   << 4) = 0x50
```

**这三个数决定了"哪些中断里能调 FreeRTOS API"**：

| 中断的抢占优先级（数值） | 能调 `xxxFromISR()` 吗 | 会被 `taskENTER_CRITICAL()` 屏蔽吗 |
| --- | --- | --- |
| **0 ~ 4**（比 5 更高） | ❌ **绝对不能** | ❌ 不会被屏蔽 |
| **5 ~ 15** | ✅ 可以 | ✅ 会被屏蔽 |
| 15（最低） | ✅ 可以 | ✅ 会被屏蔽 |

> **这条规则的物理原因**是 Cortex-M 的 `BASEPRI` 寄存器：
> **`BASEPRI = 0x50` 时，只有"优先级数值 ≥ 5"的中断被屏蔽**，0~4 照样能打断临界区。
> 所以"在优先级 2 的中断里调 `xQueueSendFromISR()`"会**破坏内核的临界区保护** → 数据错乱。
>
> **第 35 篇的"中断优先级测试"就是专门验证这件事的**（把串口中断从 2 改成 6，再关中断看还能不能收）。

---

## 三、移植的 5 个步骤

### 3.1 拷源码

`09acacc` 一次性加入 **343 个文件 / 约 10 万行**（`FreeRTOSConfig.h` 是自己写的 126 行，其余是官方源码）。

**这一步没什么技术含量，但有两条要注意**：

| 注意 | 说明 |
| --- | --- |
| **整个 `portable/` 都拷进来了** | 导致仓库里多了 ARM7/AARCH64 等一堆用不到的平台（README 遗留 #7）。**更干净的做法是只拷 `GCC/ARM_CM4F` + `MemMang/heap_4.c`** |
| **版本要记下来** | 本工程是 **V202604.01-LTS**（`d8c845a` 把注释从 `V202411.00` 改成了这个） |

### 3.2 写 `FreeRTOSConfig.h`

见 2.4。**这是唯一"必须自己想清楚"的文件**，其余都能照抄。

### 3.3 加编译项

`.eide/eide.yml` 加两组（+19 行）：

```yaml
- name: FreeRTOS_core
  files:
    - Middleware/FreeRTOS/croutine.c
    - Middleware/FreeRTOS/event_groups.c
    - Middleware/FreeRTOS/list.c
    - Middleware/FreeRTOS/queue.c
    - Middleware/FreeRTOS/stream_buffer.c
    - Middleware/FreeRTOS/tasks.c
    - Middleware/FreeRTOS/timers.c

- name: FreeRTOS_port
  files:
    - Middleware/FreeRTOS/portable/MemMang/heap_4.c
    - Middleware/FreeRTOS/portable/GCC/ARM_CM4F/port.c
```

**包含路径 3 条 + 宏 1 个**：

```
Middleware/FreeRTOS
Middleware/FreeRTOS/include
Middleware/FreeRTOS/portable/GCC/ARM_CM4F
SYS_SUPPORT_OS                    ← ★ 关键宏（第 4 章）
```

> **`SYS_SUPPORT_OS` 定义在 `eide.yml` 和 Keil 工程两处**（README 特意强调"两处都已定义"）——
> 因为**两套构建系统各读各的宏**，漏一个就会出现"Keil 能编、EIDE 报错"（第 01 篇 §7 讲过同类问题）。

### 3.4 ★ 异常映射：必须删掉自己的 `SVC/PendSV/SysTick_Handler`

**FreeRTOS 在 `FreeRTOSConfig.h` 末尾做了这个映射**：

```c
#define vPortSVCHandler      SVC_Handler
#define xPortPendSVHandler   PendSV_Handler
#define xPortSysTickHandler  SysTick_Handler
```

**意思是**：`port.c` 里写的 `vPortSVCHandler()`，**编译后名字就叫 `SVC_Handler`** ——
直接顶替启动文件里的同名弱符号。

**而本工程原来的 `gd32f4xx_it.c` 里也有这三个函数**（裸机版，里面是 `while(1)` 死循环或裸机 SysTick 逻辑）。

**两者同时存在 → 链接时"重复定义"**（`L6200E: Symbol SVC_Handler multiply defined`）。
即使因为弱符号侥幸编过，**跑起来也会是"裸机那个 `while(1)` 抢到了向量表"** → **一进 SVC 就死循环**。

**本工程的解法**：用 `SYS_SUPPORT_OS` 把裸机那三个**整段排除掉**：

```c
#ifndef SYS_SUPPORT_OS
void SVC_Handler(void)      { while (1) {} }      // 裸机：SVC 不该发生
void PendSV_Handler(void)   { while (1) {} }      // 裸机：PendSV 不该发生
void SysTick_Handler(void)  { ... }               // 裸机：1 MHz 节拍 + 1 ms 扫描
#else
void vApplicationTickHook(void)                   // RTOS：tick 钩子
{
    delay_tick_update();
    bsp_188_leds_scan();
    bsp_adkey_scan();
    bsp_digital_leds_scan();
    task_switch();
}
#endif
```

> **★ 这条是"RTOS 移植第一大坑"**：
> **内核要接管三个异常（SVC / PendSV / SysTick），你必须把自己原来写的同名函数让出来。**
> 判断方法是看链接日志有没有 `multiply defined`，或者**在 `SysTick_Handler` 里放个断点，看它到底停在你的代码还是 `port.c`**。

### 3.5 ★ 优先级分组：`PRE2_SUB2` → `PRE4_SUB0`

```c
- nvic_priority_group_set(NVIC_PRIGROUP_PRE2_SUB2);   // 裸机：2 位抢占 + 2 位响应
+ nvic_priority_group_set(NVIC_PRIGROUP_PRE4_SUB0);   // RTOS：4 位全给抢占
```

**为什么必须改？**

Cortex-M4 的 4 位优先级可以拆成"抢占位 + 响应位"（分组）。**FreeRTOS 只认"抢占优先级"**：

```
FreeRTOS 的 configMAX_SYSCALL_INTERRUPT_PRIORITY = 5
     ↓ 写进 BASEPRI（高 4 位）= 0x50
     ↓
但 BASEPRI 比较的是"NVIC 里那 4 位优先级"的全部
     ↓
如果分组是 PRE2_SUB2，那么"优先级 5"这个数
    → 抢占位 = 5>>2 = 1，响应位 = 5&3 = 1
    → 实际写进 NVIC 的值是 1<<2 | 1 = 0x05
    → 和 BASEPRI 的 0x50 比 → 根本对不上！
```

**一句话**：**分组不是 `PRE4_SUB0` 时，"优先级数值"和"BASEPRI 比较的数值"不是同一个东西**，
`configMAX_SYSCALL_INTERRUPT_PRIORITY` 就失效了 → **临界区保护的边界全乱**。

> **所以 FreeRTOS 的所有 Cortex-M 移植都要求 `NVIC_PRIGROUP_PRE4_SUB0`（4 位全抢占）**。
> 本工程原来用 `PRE2_SUB2`（因为裸机时"抢占 2 位 + 响应 2 位"够用），**移植时必须改**。
>
> **改了之后还有一个副作用**：**所有 `nvic_irq_enable(irq, pre, sub)` 的 `sub` 参数都失效了**
> （因为响应位是 0 位）。本工程 `msp_exti.c` 里还写着 `nvic_irq_enable(nvic_irq, 2, 2)` ——
> **那个 `2` 现在没有意义**，实际优先级就是 2（第 35 篇的测试会用到这个事实）。

---

## 四、`SYS_SUPPORT_OS`：一个宏管两个文件

**这是本工程移植设计最巧的一处**：**用一个宏同时切换"延时"和"中断"两套实现**。

| 文件 | `SYS_SUPPORT_OS` 未定义（裸机） | 已定义（RTOS） |
| --- | --- | --- |
| **`User/systick.c`** | SysTick **1 MHz**；`delay` 变量递减；`us_cnt++` | SysTick 归内核（1 kHz）；**`delay_1us` 改用 TIMER6**；`us_cnt` 由 tick hook 累加 |
| **`User/gd32f4xx_it.c`** | `SVC/PendSV/SysTick_Handler` 三个裸机版 | 三个全删；改 `vApplicationTickHook()` |
| **`User/main.c`** | `systick_config()` | `#ifndef SYS_SUPPORT_OS` 跳过（内核会配 SysTick） |

**两套实现的对照**：

| | 裸机版 | RTOS 版 |
| --- | --- | --- |
| SysTick 频率 | **1 MHz**（1 µs 中断一次！） | **1 kHz**（内核 tick） |
| µs 延时靠什么 | `delay` 变量（SysTick 中断里递减） | **TIMER6 自由运行计数器**（轮询差值） |
| ms 延时靠什么 | `delay = count*1000` 忙等 | `delay_1us(1000)` × count（**仍是忙等**） |
| `get_us_cnt()` | `us_cnt` 由 1 MHz 中断累加（µs 精度） | `us_cnt` 由 tick hook 累加（**1 ms 精度**） |
| 1 ms 扫描（188/ADKEY/数码管） | `SysTick_Handler` 里 `div>=1000` | `vApplicationTickHook` 里（每 tick 都执行） |

> **★ 注意一个精度变化**：**`get_us_cnt()` 从"µs 精度"退化成了"1 ms 精度"**。
> 因为 RTOS 下 SysTick 只有 1 kHz，`delay_tick_update()` 每 tick 只加 1000 µs。
>
> **影响谁？**
> - `bsp_dot_matrix_is_1s()`（32 篇）：1 秒判断 → 精度 1 ms，**够用** ✅
> - `bsp_digital_leds_scan()` 里的"1 ms 时间门"：**恒等于 tick 间隔**，门形同虚设（第 09 篇 §4.4 的双重门问题）
> - `EXTI` 消抖的 `cur_cnt - pre_cnt <= 30000`（30 ms）：**精度变成 30±1 ms**，够用 ✅
> - **任何需要 <1 ms 分辨率的场合**：**都不准了**（比如 WS2812 的 1.25 µs 时序、软件 IIC 的延时）

**这解释了为什么 `msp_iic`（软件 IIC）在 RTOS 下要特别小心**：
它的位延时靠 `for` 空转（`IIC_DELAY`），而不是 `delay_1us()` —— 所以没受影响。
但如果哪天改成 `delay_1us(1)`，**在 RTOS 下会变成"等 0~1 ms"** → I2C 时序彻底崩。

---

## 五、★★ 移植后上电卡死：完整排障链（DWT → TIMER6）

**这是本工程最有价值的一次排障**，完整记录在 `Doc/FreeRTOS移植后卡死问题与修复.md`（281 行）。这里提炼"方法"。

### 5.1 现象

```
移植 FreeRTOS 后烧录 → 串口停在 rtc 初始化之后的某一行
→ 没有 "============ start ============"
→ 没有 "SystemCoreClock = ..."
→ IIC OLED / SPI OLED / 188 数码管 / 数码管 / 点阵屏 全部无反应
```

### 5.2 五步缩小范围（★ 这套方法值得背下来）

| 步骤 | 做法 | 得到的信息 |
| --- | --- | --- |
| **① 先证明"串口没丢数据"** | `fputc()` 是**阻塞轮询 `TBE`**，不依赖中断/缓冲 | **能打第一行 ⇒ UART 通**；后面没输出 ⇒ **程序真的停住了** |
| **② 用驱动自带的报错打印当"路标"** | `bsp_iic_oled_write_byte()` 只要器件不应答就打印 `IIC device not acknowledged!` | 串口里**一条 IIC 报错都没有** ⇒ **连 `bsp_iic_oled_init()` 都没执行到** |
| **③ 把范围压到 7 个初始化** | 从 `msp_rtc_write()` 到 `bsp_buzzer_init()` | 只剩 7 个候选人 |
| **④ 逐个排除"可疑的阻塞点"** | 查每个函数里的 `while` 有没有超时 | `msp_rtc` 的 `while` **带计数超时**（0x4000/0x8000）；IIC/SPI/GPIO **无等待**；**只有 `msp_adc_init()` 里有一个 `delay_1ms(1)`** |
| **⑤ 锁定延时函数 + 反汇编确认** | `fromelf --text -c` 看 `delay_1us` 的目标码 | 寄存器地址、使能顺序、除法常量**全对** ⇒ **代码没写错，是"计数器不递增"** |

**第 ⑤ 步是最关键的思路转折**：

> **"代码写错了"和"硬件没按预期工作"是两种完全不同的故障。**
> **反汇编能一眼区分**：如果代码逻辑对、寄存器地址对，那就只能是**外设没动**。

### 5.3 根因

**裸机版和 RTOS 版的 µs 时基被换了**：

| | 裸机版（能用） | RTOS 版（卡死） |
| --- | --- | --- |
| 1 ms 节拍 | SysTick 中断（1 MHz） | **内核占用 SysTick** |
| µs 延时 | `delay` 变量被 SysTick 中断递减 | **`DWT->CYCCNT` 轮询** |
| 调度器启动前可用 | ✅ | **取决于 DWT 是否计数** |

**死等点**：

```c
// msp_adc.c:99
adc_enable(ADC0);
delay_1ms(1);                 // → delay_1us(1000) → while ((DWT->CYCCNT - start) < 168000) {}
adc_calibration_enable(ADC0); // ← 里面两个 while(RSTCLB)/while(CLB) 也没有超时
```

**如果 `DWT->CYCCNT` 不递增**：

```
(DWT->CYCCNT - start) 永远 = 0
→ 0 < 168000 恒成立
→ 永久死循环           ← 就卡在这里
```

**而 `msp_adc_init()` 恰好是"整条初始化链里第一个调用延时的地方"** —— 这解释了"为什么停在 rtc 之后"。

**还有一个"放大器"**：`adc_calibration_enable()` 里的两个 `while` **没有超时**。
即使延时只是"变短"而不是"死等"，ADC 状态异常时也会**二次卡死**。

### 5.4 修法：µs 时基换成 TIMER6

```c
#define US_TIMER      TIMER6
#define US_TIMER_RCU  RCU_TIMER6

static void us_timer_init(void)          // 只初始化一次
{
    static uint8_t inited = 0U;
    if (0U == inited)
    {
        timer_parameter_struct s;
        uint32_t us_psc;
        inited = 1U;

        rcu_periph_clock_enable(US_TIMER_RCU);
        timer_deinit(US_TIMER);

        timer_struct_para_init(&s);
        /* RCU_TIMER_PSC_MUL4 下 APB1 定时器时钟 = SystemCoreClock(168MHz) */
        us_psc = (uint32_t)(SystemCoreClock / 1000000U);   // 168
        if ((0U == us_psc) || (us_psc > 65536U))           // 时钟异常兜底
            us_psc = 168U;

        s.prescaler        = (uint16_t)(us_psc - 1U);      // 168-1 → 1 MHz
        s.period           = 0xFFFFFFFFU;                  // 32 位自由运行
        s.counterdirection = TIMER_COUNTER_UP;
        timer_init(US_TIMER, &s);
        timer_enable(US_TIMER);
    }
}

void delay_1us(uint32_t count)
{
    uint32_t start;
    us_timer_init();
    start = TIMER_CNT(US_TIMER);
    while ((TIMER_CNT(US_TIMER) - start) < count) { }      // 32 位减法自动处理回绕
}
```

**三个细节值得学**：

| 细节 | 为什么 |
| --- | --- |
| **`inited` 静态开关** | 延时函数可能在调度器启动前、任何任务、任何中断里被调用 → **必须"只初始化一次"，且不能依赖任何初始化顺序** |
| **`period = 0xFFFFFFFF`** | 让计数器**自由运行到溢出**再从头开始；`TIMER_CNT - start` 用**无符号减法**，回绕时自动得到正确差值 |
| **`SystemCoreClock/1e6` + 兜底 168** | 不写死 168。**万一 `SystemCoreClock` 还没算出来（=0）或异常，用 168 兜底** —— 比"死等"好 |

**验证方式（★ 也是方法）**：

```
fromelf --text -c 反汇编新的 delay_1us
→ 只访问 0x40001400（TIMER6 基址）+ 0x24（TIMER_CNT 偏移）
→ 不再出现 0xE0001000（DWT->CTRL）/ 0xE0001004（CYCCNT）
```

> **"改完要看反汇编"** —— 否则你无法确认"新代码真的进了固件"（而不是编到了另一个 target、或者被优化掉）。

### 5.5 为什么选 TIMER6（选型理由表）

| 方案 | 评价 |
| --- | --- |
| `DWT->CYCCNT` | 依赖 **CoreSight 调试单元**，某些配置/调试器状态/低功耗模式下**行为不可靠** → **否决** |
| `SysTick` | **已被 FreeRTOS 占用**（1 kHz 内核节拍）→ **否决** |
| **TIMER6 / TIMER5** | 基本定时器、**全工程未使用**（只有蜂鸣器用 TIMER1）、**32 位自由运行**、调度器启动前后与中断内都可用 → **采用** |
| 普通循环空转 | 依赖编译优化等级与主频 → **不可靠**（同一段代码 `-O0` 和 `-O2` 时间差几倍） |

> **这张表的思路值得记住**：**"我要一个 µs 时基"这个需求，要满足四个条件**：
> ① 不依赖调试单元；② 不被别人占用；③ 32 位（不会频繁溢出）；④ 任何上下文都能用。
> **四条一筛，TIMER6 是唯一剩下的。**

---

## 六、任务创建：`xTaskCreate` 六个参数

`c2580e2`（动态任务创建）：

```c
xTaskCreate((TaskFunction_t)task_led1,   // ① 任务函数
            (const char *)"task_led1",   // ② 任务名（调试用，≤ configMAX_TASK_NAME_LEN）
            64,                          // ③ 栈深度（★ 单位是 word，不是 byte）
            NULL,                        // ④ 传给任务的参数（不能是局部变量！）
            2,                           // ⑤ 优先级（0 = idle，越大越高）
            &task_led1_handler);         // ⑥ 任务句柄（用于 suspend/resume/delete）
```

**逐项说清"容易错的地方"**：

| 参数 | 坑 |
| --- | --- |
| ① 函数 | 必须是 **`void f(void *)`** 形态，**永不返回**（`while(1)`） |
| ② 名字 | 只有 `configMAX_TASK_NAME_LEN = 10` 字节 —— **`"task_keys_scan"` 会被截成 `"task_keys"`**（调试器里看不全） |
| ③ **栈** | ★ **单位是 word（4 字节）**。`64` = **256 字节**；`128` = 512 B；`APP_TASK_STACK_SIZE = 512` = **2 KB** |
| ④ 参数 | **不能传局部变量地址**（任务运行时那个栈帧早没了）；一般传全局/静态变量的地址 |
| ⑤ 优先级 | 范围 0 ~ `configMAX_PRIORITIES-1` = **0~4**。**传 5 会被 clamp 到 4**（有些版本直接断言） |
| ⑥ 句柄 | 若不需要控制可以传 `NULL`；本工程 `task1/2/3` 都要用来 suspend/delete，所以都传了 |

**`c2580e2` 做的两个演示任务**：

```c
void task_led1(void *pvParameters)
{
    while (1)
    {
        vTaskDelay(1000);          // ★ 1000 个 tick = 1000 ms（因为 tick=1 kHz）
        bsp_leds_open(LED1);
        vTaskDelay(1000);
        bsp_leds_close(LED1);
    }
}

void task_led2(void *pvParameters)
{
    while (1)
    {
        vTaskDelay(100);           // 100 ms
        bsp_leds_open(LED2);
        vTaskDelay(100);
        bsp_leds_close(LED2);
    }
}
```

**`vTaskDelay(1000)` vs `vTaskDelay(pdMS_TO_TICKS(1000))`**：

| 写法 | 含义 | 风险 |
| --- | --- | --- |
| `vTaskDelay(1000)` | **1000 个 tick** | ⚠️ **改 `configTICK_RATE_HZ` 就失效**（比如改成 100 Hz，就变成 10 秒） |
| `vTaskDelay(pdMS_TO_TICKS(1000))` | 1000 **毫秒** | ✅ 与 tick 频率解耦 |

> **本工程 `c2580e2` 用的是前者，后来（`193555f`）全改成了 `pdMS_TO_TICKS()`** ——
> 这是"临时验证"到"正式代码"的一步改进。

**注意 `task_led1/2` 的周期算一下**：

```
task_led1：delay(1000) → on → delay(1000) → off
         → 亮 1 s、灭 1 s、周期 2 s

task_led2：delay(100)  → on → delay(100)  → off
         → 亮 100 ms、灭 100 ms、周期 200 ms
```

**两个任务同优先级（2）→ 时间片轮转**：它们会**交替执行**（每个 tick 切换一次），看起来"同时"在闪。

> **这就是 33 篇"不能抢占"的对照**：那个框架里，`task_led1` 的 `delay_1ms(1000)` 会**把整个任务表卡住 1 秒**；
> 而 RTOS 里 `vTaskDelay(1000)` **只是把当前任务放进延时表**，CPU 立刻去跑别的任务。

---

## 七、`vTaskStartScheduler()` 之后

```c
vTaskStartScheduler();

// 只有堆内存不足、调度器启动失败时才会执行到这里
while (1)
{
    printf("heap full!\r\n");
}
```

**三个"必须知道"的事实**：

| 事实 | 说明 |
| --- | --- |
| **正常情况下永不返回** | 调度器启动后会切到第一个任务，`main()` 的栈就不再用了 |
| **能走到 `while(1)` 说明"堆不够"** | `xTaskCreate` 失败（idle 任务或 timer 任务建不出来）→ 调度器无法启动 |
| **`main()` 里的局部变量此后无效** | 因为 `main` 的栈在调度器启动后**被当成"最后一个任务的栈"或废弃** —— 所以 **`main()` 里的局部数组不能给任务当参数** |

**本工程在这之后建的是"测试任务区"**（`193555f`）：

```c
{
    mutex_Semaphore_Handle = xSemaphoreCreateMutex();   // ← 注意：在调度器启动"前"创建
    xTaskCreate(task1, "task1", 128, NULL, 2, &task1_handle);
    xTaskCreate(task2, "task2", 128, NULL, 2, &task2_handle);
    xTaskCreate(task3, "task3", 128, NULL, 2, &task3_handle);
    xTaskCreate(task_keys_scan, "task_keys_scan", 64, NULL, 3, &task_keys_scan_handle);
}
vTaskStartScheduler();
```

> **`xSemaphoreCreateMutex()` 在 `vTaskStartScheduler()` 之前调用是合法的** ——
> 因为创建信号量只是"分配内存 + 初始化结构体"，不需要调度器在跑。
> **但 `xSemaphoreTake()` 不能在调度器启动前调**（会阻塞，而那时没有调度器）。

---

## 八、遗留问题与隐患

**工程 README 自己列了 11 条**，加上本篇读代码发现的，整理如下：

| # | 问题 | 严重度 | 说明 |
| --- | --- | --- | --- |
| **1** | **`configCHECK_FOR_STACK_OVERFLOW = 0`** | 🔴 高 | 任务栈溢出**不会有任何提示**，直接踩坏别人的 RAM。改成 `2` 只增加几个字节开销 |
| **2** | **`configUSE_MALLOC_FAILED_HOOK = 0`** | 🟠 中 | `xTaskCreate` 失败只返回错误码，没人检查 → **任务静默不运行** |
| **3** | **`configMAX_TASK_NAME_LEN = 10`** | 🟡 低 | `"task_keys_scan"` 被截断，调试器里看不到全名 |
| 4 | **`get_us_cnt()` 64 位读非原子** | 🟠 中 | 32 位 MCU 读 `uint64_t` 是两条指令，可能读到"半新半旧"的值。需要 `__disable_irq()` 或 PRIMASK 保存 |
| 5 | **`vApplicationTickHook()` 负载偏重** | 🟠 中 | 1 ms 内做 **3 路扫描 + 任务计数 + µs 累加**。这是"把裸机的 SysTick 中断原样搬过来"的后果 |
| 6 | **主栈 `Stack_Size = 0x400`（1 KB）偏小** | 🟠 中 | FreeRTOS 任务栈之外，**主栈还要供中断嵌套和中断里的局部变量**用。建议 `0x800` |
| 7 | **`on_rtc_alarm` 重复定义** | 🟡 低 | `msp_rtc.c` 与 `bsp_pcf8563.c` 各一份 → 链接警告 `L6439W` |
| 8 | **`portable/` 未精简** | 🟡 低 | 343 个文件里只编 9 个。**仓库体积 + `grep` 噪音** |
| 9 | **选了 `GCC/ARM_CM4F` 而不是 `RVDS/ARM_CM4F`** | 🟡 低 | AC6 能编，但官方推荐 RVDS 版 |
| 10 | **`main.c` 里的临时诊断打印还在** | 🟡 低 | `[boot] SystemCoreClock` / `[boot] DWT_CYCCNT` / `[init] xxx ok` —— **文档自己列的 P1 待办** |
| 11 | **周期任务未拆分** | 🟠 中 | 6 个 `app_show_*` 任务仍靠 `app_task` 轮询 `task_schedule()`，**没有变成独立 FreeRTOS 任务**（代码里有 `TODO`） |
| **12** | **测试代码占了 `main.c` 一大半** | 🟠 中 | `task1/2/3` 是互斥量演示，不是产品功能。**正式版应挪进 `App/app_test/`** |
| **13** | **软件 IIC 没有互斥量保护** | 🔴 高 | IIC OLED / PCF8563 / SC12B 共用 PB6/PB7，**现在靠"中断只置标志"规避重入，但任务之间没有互斥** → 两个任务同时读 IIC 会踩（第 35 篇的互斥量正是为此准备的，但还没用到 IIC 上） |

> **第 11 条和 13 条是本篇最该记住的两条**：
> **"移植了 RTOS" ≠ "用上了 RTOS"**。
> 现在的情况是：**内核在跑，但业务还在用"裸机的调度方式"**（`app_task` 里 `task_schedule()`）。
> 真正该做的是：**把 6 个 `app_show_*` 拆成 6 个独立任务**（各自 `vTaskDelay`），
> 并给 IIC/SPI 加互斥量 —— 那时候才算"真的用上了 RTOS"。

---

## 九、参数速查表 / 排查清单

### 9.1 参数速查

| 项目 | 值 | 出处 |
| --- | --- | --- |
| FreeRTOS 版本 | **V202604.01-LTS** | 源码注释 |
| 移植层 | **`portable/GCC/ARM_CM4F/port.c`** | `eide.yml` |
| 内存管理 | **`heap_4.c`**，**75 KB** | `FreeRTOSConfig.h` |
| 内核源文件 | **7 个**（tasks/queue/list/timers/event_groups/stream_buffer/croutine）+ port 2 个 | `eide.yml` |
| tick 频率 | **1000 Hz（1 ms）** | `configTICK_RATE_HZ` |
| 优先级数 | **5**（0~4） | `configMAX_PRIORITIES` |
| idle 栈 | **130 words = 520 B** | `configMINIMAL_STACK_SIZE` |
| 可调 API 的最高优先级 | **5** | `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` |
| `BASEPRI` 实际值 | **0x50** | `5 << 4` |
| 内核中断优先级 | **0xF0**（最低） | `0xF << 4` |
| 优先级分组 | **`PRE4_SUB0`**（4 位全抢占） | `main.c` |
| µs 时基 | **TIMER6**，PSC=167 → 1 MHz，period=0xFFFFFFFF | `systick.c` |
| `get_us_cnt()` 精度 | **1 ms**（tick hook 累加） | `systick.c` |
| `app_task` 栈/优先级 | 512 words（2 KB）/ `tskIDLE+3` = 3 | `main.c` |
| 测试任务栈 | task1/2/3 = 128 words（512 B）；keys_scan = 64 words（256 B） | `main.c` |
| 双模式宏 | **`SYS_SUPPORT_OS`**（`eide.yml` + Keil 两处） | `eide.yml` |

### 9.2 排查清单（移植类）

| # | 现象 | 最可能的原因 | 怎么查 |
| --- | --- | --- | --- |
| **1** | **上电就卡死，串口只输出一半** | ★ **µs 延时用了 DWT，而 DWT 不计数** | 查 `delay_1us` 的实现；反汇编看是否访问 `0xE0001004`；改用 TIMER6（§5） |
| **2** | 编译报 `SVC_Handler multiply defined` | **没删掉 `gd32f4xx_it.c` 里的裸机版三个 Handler** | 用 `#ifndef SYS_SUPPORT_OS` 包住（§3.4） |
| **3** | 能编过，但一启动就进 `HardFault` 死循环 | 同上（弱符号抢了向量，进了裸机的 `while(1)`） | 看 `SCB->VTOR` / 在 `SysTick_Handler` 下断点 |
| **4** | 系统跑起来但**时间全错**（延时 10 倍/1/10） | `configCPU_CLOCK_HZ` 或 `configTICK_RATE_HZ` 配错 | 用 GPIO 翻转实测 tick 周期 |
| **5** | **中断里调 `xxxFromISR()` 偶尔死机** | ★ **中断优先级数值 < 5**（比 `configMAX_SYSCALL_INTERRUPT_PRIORITY` 高） | 查该中断的 `nvic_irq_enable(irq, pre, sub)` 的 `pre`；或**没改 `PRE4_SUB0` 分组** |
| **6** | 临界区保护"好像没用" | 同上（分组不是 `PRE4_SUB0`，`BASEPRI` 对不上） | 查 `nvic_priority_group_set()` |
| **7** | `xTaskCreate` 返回失败 | 堆不够（75 KB 用完了） | 看返回值（本工程**没检查**）；`xPortGetFreeHeapSize()` |
| **8** | 调度器起不来，打印 `heap full!` | idle/timer 任务建不出来 | 加大 heap 或减任务 |
| **9** | 某个任务**从来不跑** | 优先级太低被饿死；或 `xTaskCreate` 失败没检查 | 用 `uxTaskGetSystemState()` 看任务列表 |
| **10** | 任务跑一会儿就死 | **栈溢出**（`configCHECK_FOR_STACK_OVERFLOW = 0` 不会报） | 临时改成 2；或把栈加大一倍试 |
| **11** | `vTaskDelay(1000)` 变成 10 秒 | 有人改了 `configTICK_RATE_HZ` | 改用 `pdMS_TO_TICKS()` |
| **12** | 调试器里任务名显示不全 | `configMAX_TASK_NAME_LEN = 10` | 改大到 16 |
| **13** | 移植后 I2C/OLED 偶发失败 | **`get_us_cnt()` 精度变成 1 ms**，若有代码依赖 µs 级延时就会乱 | 查该模块的延时实现（§4 末尾） |

---

## 十、自测题 + 练习题

### 10.1 自测题

1. FreeRTOS 的 343 个文件里，本工程实际编译哪 9 个？`port.c` 负责哪三件事？
2. `portable/GCC/ARM_CM4F` 和 `portable/RVDS/ARM_CM4F` 有什么区别？本工程选的哪个？
3. `heap_4` 比 `heap_2` 强在哪？为什么"堆开大一点"是错的？
4. `configTICK_RATE_HZ = 1000` 和裸机的 "SysTick 1 MHz" 是什么关系？为什么必须换 µs 时基？
5. **为什么必须删掉 `gd32f4xx_it.c` 里的 `SVC_Handler` / `PendSV_Handler` / `SysTick_Handler`？**
6. **为什么优先级分组必须从 `PRE2_SUB2` 改成 `PRE4_SUB0`？** 用 `BASEPRI` 的数值算一遍。
7. `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY = 5` 意味着"优先级几到几的中断可以调 API"？
8. 本工程卡死的根因是什么？为什么恰好卡在 `msp_adc_init()`？
9. 为什么选 TIMER6 而不是 DWT / SysTick / 空转循环？四条判据是什么？
10. `xTaskCreate` 第三个参数 `128` 是多少字节？为什么不是 128 字节？
11. `vTaskDelay(1000)` 和 `vTaskDelay(pdMS_TO_TICKS(1000))` 有什么区别？改 tick 频率时哪个会坏？
12. 现在 `get_us_cnt()` 的精度是多少？哪三个模块会受影响？
13. 为什么说"移植了 RTOS ≠ 用上了 RTOS"？本工程还差哪两件事？

### 10.2 练习题

1. **实测 tick**：在一个任务里每 tick 翻转一个 GPIO，用示波器量周期，验证 `configTICK_RATE_HZ` 是否真的是 1 kHz。
2. **打开栈检查**：把 `configCHECK_FOR_STACK_OVERFLOW` 改成 2，然后故意把某个任务栈改小到 32 words，看会不会触发 `vApplicationStackOverflowHook()`（需要自己实现这个钩子）。
3. **拆一个任务**：把 `app_show_iic_oled_task` 从 `taskmanager` 里拿出来，改成独立的 `xTaskCreate` + `vTaskDelay(100)`，观察"OLED 刷屏不再拖累其他任务"的效果。
4. **给 IIC 加互斥量**：创建 `xSemaphoreCreateMutex()`，在 `msp_iic_write_nbyte` / `read_nbyte` 前后 take/give，然后造两个任务同时读 PCF8563 和 SC12B，验证不再花屏。
5. **算 RAM**：统计当前所有任务栈 + heap 75 KB + 全局变量，算出 RAM 剩余，判断还能加几个任务。
6. **改回裸机**：注释掉 `SYS_SUPPORT_OS`，确认工程能回到裸机版本（需要同时确认三个 Handler 恢复、`systick_config()` 恢复）——**这是验证"双模式开关"是否真的干净的最好实验**。
7. **看反汇编**：用 `fromelf --text -c` 导出 `delay_1us`，确认它只访问 TIMER6；再把实现临时改回 DWT，对比反汇编差异。
8. **读 `port.c`**：打开 `portable/GCC/ARM_CM4F/port.c`，找出 `xPortPendSVHandler` 保存/恢复了哪 16 个寄存器 + 哪些浮点寄存器，算一次上下文切换大概要多少字节栈空间。

---

## 附：提交清单

| # | 提交 | 日期 | 分支 | 说明 | 改动 |
| --- | --- | --- | --- | --- | --- |
| 1 | `09acacc` | 2026-10-19 19:42 | main | [更新] 移植 FreeRTOS | **`Middleware/FreeRTOS/` 全量加入**（343 文件）+ 自写 `FreeRTOSConfig.h`（126 行）+ `eide.yml` +19（编译项/包含路径/`SYS_SUPPORT_OS`） |
| 2 | **`343361a`** | 2026-10-19 20:13 | main | **[修复] FreeRTOS 移植后初始化卡死，微秒延时基准由 DWT 改为 TIMER6** | `systick.c` +52/-18（**新增 `#else` 分支：TIMER6 自由运行**）；`main.c` +18（`[boot]`/`[init]` 诊断打印 + DWT 自检）；`msp_rtc.c` 1 行（注释调试打印）；**新增 `Doc/FreeRTOS移植后卡死问题与修复.md`（281 行）**；`.vscode/settings.json` +3 |
| 3 | `c2580e2` | 2026-10-19 20:42 | main | [更新] FreeRTOS 动态任务创建 | `main.c` +58/-25：两个 `xTaskCreate`（`task_led1` 2 s 周期 / `task_led2` 200 ms 周期，同优先级 2） |
| 4 | `3800637` | 2026-10-19 21:03 | main | **[合并]** 移植 FreeRTOS（GD32F407 / ARM_CM4F + heap_4），合并裸机多任务分支 | 把 `bare_machine_multitask`（33 篇的 `7f55853`/`7163c92`）与 FreeRTOS 两条线合流；`eide.yml` +30；`FreeRTOSConfig.h` 落定 |
| 5 | `d8c845a` | 2026-10-19 21:19 | main | [更新] README 按 FreeRTOS 移植后的真实结构重写 | `README.md` +286/-93（目录结构、FreeRTOS 集成、任务划分、已知遗留 11 条）；**`FreeRTOSConfig.h` 102 行只是"格式化"**（版本注释改 `V202604.01-LTS`、tab→空格，**数值一个没改**） |

**这个模块的三级台阶**

| 台阶 | 提交 | 解决了什么 | 遗留 |
| --- | --- | --- | --- |
| 1. 能编过 | `09acacc` | 源码 + config + 编译项 + 异常映射 + 分组 | **上电卡死** |
| 2. 能跑起来 | `343361a` | **µs 时基换 TIMER6**；诊断打印定位 | `get_us_cnt()` 精度退化、tick hook 偏重 |
| 3. 会用 | `c2580e2` | 动态创建任务（`xTaskCreate`） | **业务仍在用裸机调度**（`app_task` + `task_schedule`） |

> **注意第 3 级台阶还没走完**（遗留 #11）：`app_task` 还是"一个任务 + 一张表"。
> **真正"用上 RTOS"是 35 篇之后的事** —— 那一篇才把同步机制逐个验证。

---

## 参考笔记

- **`../GD32F407_myLibrary/Doc/FreeRTOS移植后卡死问题与修复.md`（281 行）** —— ★ **本篇第五章的原始文档**，也是本工程**最好的一份排障记录**：现象 → 五步缩小范围 → 根因 → 修法 → 反汇编验证 → 8 条待办 → 5 条经验。
- **`../GD32F407_myLibrary/README.md`** §目录结构 / §FreeRTOS 集成 / §已知遗留与待办 —— 作者自己对移植结果的总结（注意**§任务划分那张表已过期**：写的是 `task_led1/task_led2`，10-21 已被 `task1/2/3/keys_scan` 替换）。
- **`Middleware/FreeRTOS/FreeRTOSConfig.h`** —— 本篇 2.4 节的原文；每个宏的官方说明在 `Middleware/FreeRTOS/include/FreeRTOS.h` 的配置章节。
- **`Middleware/FreeRTOS/portable/GCC/ARM_CM4F/port.c`** —— "移植"两个字的实体：`vPortSVCHandler` / `xPortPendSVHandler` / `xPortSysTickHandler`。
- `../../../NOTE/Note/TASK.md` §4.6「从裸机多任务到 RTOS：什么时候该升级」—— 与第 33 篇第五章配套读。

> **关于教材**：`ARM/NOTE/Textbook/` 里**没有 FreeRTOS 章节的可读快照**（教材目录里有标题，但没有对应的 `.mhtml`）。
> 本篇依据的是 FreeRTOS 官方源码、工程配置与工程内排障文档。
>
> 本笔记仅作学习整理，内容来自本仓库真实提交记录与源码。
