# 35 · FreeRTOS 同步与中断机制（9 个验证实验）· 学习笔记

> 这一篇讲 **9 次提交**（`1a8efcb` → `6a313c5` + 合并 `193555f`），是作者在移植完 RTOS 之后做的一轮**"把内核机制逐个验证一遍"**的实验：
> 任务优先级 → 挂起恢复 → **临界区（无保护/有保护）** → **中断优先级** → 软件定时器 → 二值/计数/**互斥**信号量。
> 它和第 34 篇是"移植"与"使用"的关系：**34 讲怎么让 RTOS 跑起来，这一篇讲怎么用它解决 33 篇留下的并发问题。**
> 整理日期：2026-10-21　｜　提交范围：`1a8efcb`、`d0fdec4`、`567aead`、`2fa56a8`、`39add3e`、`e6fa686`、`3acac6e`、`5d97c6d`、`d69c991`、`6a313c5`（+ 合并 `193555f`）

---

## 怎么读这份笔记

| 你的情况 | 直接跳 |
| --- | --- |
| 只想搞懂"临界区到底防住了什么" | **第三章**（有/无保护的对比实验，本工程真实跑过） |
| 想搞懂"为什么中断优先级 5 是个分水岭" | ★ **第四章**（`BASEPRI` 机制，本篇最重要） |
| 分不清二值/计数/互斥信号量 | **第六章**对照表 |
| 想知道软件定时器和硬件定时器怎么选 | 第五章 |
| 想照着做一遍实验 | 每个实验都有"怎么观察现象" |
| 卡住了 | 第八章排查清单 |

---

## 知识点地图

```
35 FreeRTOS 同步与中断（9 个实验）
├── 一、实验路线图（9 个提交对应 7 个概念）
├── 二、任务优先级与挂起恢复（1a8efcb / d0fdec4）
│   ├── 2.1 ★ "优先级饥饿"演示：高优先级不加 delay，低优先级永远不跑
│   └── 2.2 vTaskSuspend / vTaskResume
├── 三、临界区（567aead / 2fa56a8）★ 竞态实验
│   ├── 3.1 为什么写 j = n + 1; n = j;（而不是 n++）
│   ├── 3.2 为什么把优化等级降到 -O0
│   ├── 3.3 有无保护的预期结果
│   └── 3.4 taskENTER_CRITICAL 的代价
├── 四、★★ 中断优先级与 BASEPRI（39add3e）
│   ├── 4.1 三个数字：4 位优先级 / 5 / 0xF0
│   ├── 4.2 为什么"优先级数值 ≥ 5 的中断才归 FreeRTOS 管"
│   ├── 4.3 实验：关中断后串口还能不能收
│   └── 4.4 三种"临界区"的区别（关中断 / taskENTER_CRITICAL / FromISR）
├── 五、软件定时器（e6fa686）
│   ├── 5.1 它是"一个任务 + 一个命令队列"
│   └── 5.2 三种"定时"的对照（硬件定时器 / 软件定时器 / taskmanager）
├── 六、三种信号量（3acac6e / 5d97c6d / d69c991）
│   ├── 6.1 二值：一次给一个
│   ├── 6.2 计数：一次给 N 个
│   ├── 6.3 互斥：有"所有权"+"优先级继承"
│   └── 6.4 ★ 三者对照 + 优先级反转
├── 七、9 个实验汇总表
├── 八、遗留问题与隐患
├── 九、参数速查表 / 排查清单
└── 十、自测题 + 练习题
```

---

## 学习目标

1. 高优先级任务不加 `vTaskDelay()` 会怎样？为什么？
2. `n++` 被拆成 `j = n+1; n = j;` 之后，为什么**竞态概率会大幅上升**？
3. **为什么 `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY = 5` 意味着"优先级 0~4 的中断不能调 API"？**
4. `portDISABLE_INTERRUPTS()` 关的是哪个寄存器？为什么它**屏蔽不了**优先级 2 的中断？
5. 二值信号量、计数信号量、互斥量三者的区别是什么？**为什么互斥量能解决优先级反转？**
6. 软件定时器的回调运行在哪个上下文？能不能在里面调 `vTaskDelay()`？
7. `configTICK_RATE_HZ = 1000` 时，`vTaskDelay(pdMS_TO_TICKS(300))` 实际延时多少？

---

## 一、实验路线图

| # | 提交 | 实验 | 验证的概念 | 一句话结论 |
| --- | --- | --- | --- | --- |
| 1 | `1a8efcb` | **任务优先级** | 抢占 + 饥饿 | 高优先级不加 delay → 低优先级**永远**不跑 |
| 2 | `d0fdec4` | 挂起 / 恢复 | `vTaskSuspend` / `vTaskResume` | 被挂起的任务**连 tick 都不给它** |
| 3 | `567aead` | **临界区（无保护）** | 竞态 | 两个任务各加 100 万次，结果 **< 200 万** |
| 4 | `2fa56a8` | **临界区（有保护）** | `taskENTER_CRITICAL` | 加临界区后 **= 200 万** |
| 5 | `39add3e` | **中断优先级** | `BASEPRI` / `FromISR` 边界 | 优先级 ≥5 的中断能被屏蔽；<5 的不能 |
| 6 | `e6fa686` | 软件定时器 | `xTimerCreate` / `Start` / `Stop` | 回调在**定时器服务任务**里跑，不是中断 |
| 7 | `3acac6e` | **二值信号量** | `CreateBinary` | 一次 `Give` 只唤醒**一个**等待者 |
| 8 | `5d97c6d` | **计数信号量** | `CreateCounting(5,3)` | 可累计到上限，一次能放行多个 |
| 9 | `d69c991` | **互斥量** | `CreateMutex` | 有所有权 + **优先级继承** |
| — | `6a313c5` | 补充注释 | —— | 整理 |
| — | `193555f` | 合并 | —— | 把这 9 个实验合成一个"测试集"合入主线 |

> **这 9 个实验的顺序不是随机的**，它遵循一条"从**调度**到**互斥**"的递进：
>
> ```
> 谁能跑（优先级）→ 谁能停（挂起）→ 一起跑会怎样（竞态）→ 怎么防（临界区）
> → 防到什么边界（中断优先级）→ 怎么等（信号量）→ 怎么定时（软件定时器）
> ```

---

## 二、任务优先级与挂起恢复

### 2.1 ★ "优先级饥饿"演示（`1a8efcb`）

```c
void task1(void *pvParameters)
{
    while (1)
    {
        printf("task1\n");       // ★ 没有 vTaskDelay！
    }
}

void task2(void *pvParameters)
{
    while (1)
    {
        printf("task2\n");       // ★ 也没有 vTaskDelay！
    }
}

// 创建：task1 优先级 2，task2 优先级 3
xTaskCreate(task1, "task1", 64, NULL, 2, &task_led1_handle);
xTaskCreate(task2, "task2", 64, NULL, 3, &task_led2_handle);
```

**现象**：串口里**只有 `task2` 在刷**，`task1` 一次都不打印。

**原因**：

```
task2 优先级 3 > task1 优先级 2
task2 的 while(1) 里没有任何"让出 CPU"的调用（vTaskDelay / 阻塞 API）
    → task2 永远处于"就绪"状态
    → 调度器每次选"最高优先级的就绪任务" → 永远选 task2
    → task1 永远轮不到
```

**这叫什么**：

| 术语 | 含义 |
| --- | --- |
| **饥饿（starvation）** | 低优先级任务**理论上能跑**，但实际永远得不到 CPU |
| **死循环任务** | 一个 `while(1)` 里没有任何阻塞调用的任务 —— **在 RTOS 里是"反模式"** |

**★ 和裸机的对照**：

| | 裸机任务表（33 篇） | FreeRTOS（本篇） |
| --- | --- | --- |
| 一个任务 `while(1)` 空转 | **整个系统卡死**（主循环回不来） | **只饿死比它优先级低的任务**，比它高的照样跑 |
| 原因 | 只有一个执行流 | 调度器 + **PendSV 强制切换** |

> **所以"RTOS 里所有任务都必须有阻塞点"** ——
> 经验规则：**`while(1)` 里必须至少有一个 `vTaskDelay()` / `xQueueReceive()` / `xSemaphoreTake()` 之类的阻塞调用**。
> 本工程后面所有任务（`task1/2/3`、`task_keys_scan`）都补上了 `vTaskDelay()`，就是这个原因。

**另外注意**：`task1` 和 `task2` 的**栈只有 64 words = 256 B** ——
`printf("task2\n")` 需要格式化缓冲 + 调用栈，**256 B 很紧张**（`configCHECK_FOR_STACK_OVERFLOW = 0`，溢出了也不会报）。

### 2.2 挂起 / 恢复（`d0fdec4`）

修好饥饿问题后（给 task2 加 `vTaskDelay(1000)`），加了一个"按键控制挂起"的实验：

```c
void task_keys_scan(void *pvParameters)
{
    while (1)
    {
        bsp_keys_scan();                 // 100 ms 扫一次按键
        vTaskDelay(pdMS_TO_TICKS(100));
    }
    vTaskDelete(NULL);
}

void on_key_press(KEY_NUM key)
{
    if (key == KEY1)
    {
        printf("suspend task1\n");
        vTaskSuspend(task1_handle);      // ★ 挂起
    }
    else if (key == KEY2)
    {
        printf("resume task1\n");
        vTaskResume(task1_handle);       // ★ 恢复
    }
}
```

**`vTaskSuspend` / `vTaskResume` 和 `vTaskDelay` 的区别**：

| | `vTaskDelay(n)` | `vTaskSuspend()` |
| --- | --- | --- |
| 什么时候恢复 | **n 个 tick 后自动** | **必须别人调 `vTaskResume()`** |
| 状态 | 阻塞态（在延时表里） | **挂起态**（不在任何就绪/延时表里） |
| 谁能让它恢复 | 时间 | 只有 `vTaskResume` |
| 用途 | 周期任务 | **临时停掉一个任务**（调试、省电、等条件） |

> **一个细节**：被挂起的任务**连 tick 都不消耗**（不在就绪表里，调度器根本不看它）。
> 而 `vTaskDelay` 的任务每个 tick 都要被"检查一次是否该唤醒"。
> 所以 **"长时间不需要跑"的任务用挂起比用大 delay 更省**（虽然省得不多）。

**⚠️ 本实验的一个隐患**：`on_key_press()` 是在 `bsp_keys_scan()` 里被调用的，
而 `bsp_keys_scan()` 运行在 `task_keys_scan` 任务里（**100 ms 周期**）
→ **按键响应有最多 100 ms 延迟**。
裸机版用 EXTI 中断（第 06 篇，30 ms 消抖）——**这里反而变慢了**。

---

## 三、临界区（★ 竞态实验）

### 3.1 `567aead`：无保护的竞态

```c
uint32_t n = 0;                    // ★ 全局，两个任务都改

void task1(void *pvParameters)
{
    for (uint32_t i = 0; i < 1000000; i++)
    {
        uint32_t j = n + 1;        // ① 读 n
        n = j;                     // ② 写 n
    }
    printf("task1:%d\n", n);
    vTaskDelete(task1_handle);
}

void task2(void *pvParameters)     // 完全一样
{ ... }

// 两个任务都是优先级 2
xTaskCreate(task1, "task1", 128, NULL, 2, &task1_handle);
xTaskCreate(task2, "task2", 128, NULL, 2, &task2_handle);
```

**预期**（如果完全串行）：`n = 2 000 000`
**实际**：**明显小于 200 万**（比如 100 万零几百）。

**为什么**：

```
task1 执行到 ① 读完 n = 100，还没来得及 ②
    ↓ 遇到 SysTick，PendSV 切换（两个任务同优先级 → 时间片轮转，每 tick 强制切）
task2 也执行 ① 读到 n = 100
    ↓ task2 执行 ② 写入 n = 101
task1 恢复，执行 ② 写入 n = 101     ← ★ task1 那次 +1 被吃掉了
```

**这就是"读-改-写"竞态**（read-modify-write race）。

### 3.2 为什么写 `j = n + 1; n = j;` 而不是 `n++`

**这是一个非常讲究的写法**：

| 写法 | `-O2` 下编译器可能生成 | 竞态窗口 |
| --- | --- | --- |
| `n++` | `LDR / ADD / STR`（3 条）**或** 被优化成一条原子指令（Cortex-M4 有 `LDREX/STREX`，但普通 `n++` 不会自动用它） | 取决于优化结果，**不稳定** |
| **`j = n + 1; n = j;`** | **明确是 `LDR / ADD / STR` 三步** | **稳定地把窗口拉大** |

> **本实验要的是"能被观察到的竞态"**，所以**故意写成三步**，并且 ——
> **把优化等级降到 `-O0`**（两次提交的标题都写了"编译器优化等级暂时调整为 -0"）。
>
> 如果在 `-O2` 下，编译器可能把整个 `for` 循环优化成 `n += 1000000`（一次加法），
> **竞态就完全消失了** —— 那这个实验就白做了。
>
> **★ 这是"做实验"和"写产品"的区别**：产品要 `-O2` 快，实验要 `-O0` 稳定复现。

### 3.3 `2fa56a8`：加临界区

```c
for (uint32_t i = 0; i < 1000000; i++)
{
    taskENTER_CRITICAL();          // ★ 进入临界区（关中断到 BASEPRI）
    {
        uint32_t j = n + 1;
        n = j;
    }
    taskEXIT_CRITICAL();           // ★ 离开（恢复 BASEPRI）
}
```

**结果**：`n = 2 000 000` ✅

**`taskENTER_CRITICAL()` 做了什么**：

```c
#define taskENTER_CRITICAL()   portENTER_CRITICAL()
// portENTER_CRITICAL() 展开后大致是：
//   uxCriticalNesting++;
//   if (uxCriticalNesting == 1) portDISABLE_INTERRUPTS();
//       → __asm { CPSID i } 或 写 BASEPRI = configMAX_SYSCALL_INTERRUPT_PRIORITY
//   并且它会保存/恢复中断状态（可以嵌套）
```

**三点必须知道**：

| 点 | 说明 |
| --- | --- |
| **它是"关中断"，不是"上锁"** | 临界区期间**调度器不能切换任务**（因为切换靠 PendSV，PendSV 优先级最低 → 被 BASEPRI 屏蔽了） |
| **可以嵌套** | `uxCriticalNesting` 计数，只有最外层真正关中断 |
| **必须成对** | 中途 `return` / 死循环 → **中断永远关着** → 系统假死（所以本工程用 `{}` 块把代码包起来是**好习惯**） |

**代价（这是"临界区不能滥用"的原因）**：

```
临界区期间 = 所有"优先级数值 ≥ 5"的中断都被屏蔽
    → SysTick 被屏蔽 → tick 丢失 → 所有时间相关的功能都漂移
    → 串口接收中断被屏蔽 → 可能丢字节
    → 如果把 printf（几 ms）放进临界区 → 整个系统卡几 ms
```

> **经验规则**：**临界区里只放"几条指令"**（改一个变量、改一个链表指针）。
> **超过几十条指令就该改用信号量/互斥量**（让任务阻塞，而不是让中断停摆）。

### 3.4 两种"保护"的本质区别（★ 这张表很重要）

| | **临界区**（`taskENTER_CRITICAL`） | **互斥量**（`xSemaphoreTake`） |
| --- | --- | --- |
| 保护谁 | **中断 vs 任务** 之间的共享数据 | **任务 vs 任务** 之间的共享资源 |
| 手段 | **关中断**（屏蔽 ≥5 的中断） | **让任务阻塞**（其他任务照常跑，中断照常响应） |
| 谁能进 | 拿到 CPU 的那个（因为别人都被中断屏蔽卡住了） | 拿到锁的那个 |
| 代价 | **中断延迟**（tick 丢失、串口丢字节） | **优先级反转**（除非用互斥量的优先级继承） |
| 适合 | **极短的临界段**（改一个变量） | **较长的事务**（I2C 传输、刷屏） |

**一句话**：

```
临界区 = "大家都别动"（关中断）
互斥量 = "排队一个一个来"（任务阻塞）
```

> **本工程将来的正确做法**（第 34 篇遗留 #13）：
> **I2C 总线要用互斥量**（一次传输几百 µs，不能关中断）；
> **而那些 `g_xxx_int_flag` 的读写，其实用临界区更合适**（一条指令的事）。

---

## 四、★★ 中断优先级与 `BASEPRI`

**这是本篇最重要的一章**，也是"RTOS 移植第二大坑"（第一大坑是第 34 篇的异常映射）。

### 4.1 三个数字

```
Cortex-M4 有 4 位优先级（configPRIO_BITS = 4）→ 16 个优先级（0~15，0 最高）
    ↓ 写进 NVIC 时放在高 4 位 → 实际寄存器的值是 priority << 4

configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY = 5
    ↓
configMAX_SYSCALL_INTERRUPT_PRIORITY = 5 << 4 = 0x50
    ↓ 写进 BASEPRI

configLIBRARY_LOWEST_INTERRUPT_PRIORITY = 0xF
    ↓
configKERNEL_INTERRUPT_PRIORITY = 0xF << 4 = 0xF0   （PendSV/SysTick 用这个，最低）
```

**`BASEPRI` 的作用机制**（这是理解一切的关键）：

```
BASEPRI = 0x50

   中断优先级数值 = 2  → 2 < 5  → 数值更小 = 更紧急 → ★ 不被屏蔽（可以打断临界区）
   中断优先级数值 = 5  → 5 ≥ 5  → ★ 被屏蔽
   中断优先级数值 = 6  → 6 ≥ 5  → ★ 被屏蔽
   中断优先级数值 = 15 → 被屏蔽
```

> **★ 注意这个"反直觉"的方向**：
> **`BASEPRI` 屏蔽的是"优先级数值 ≥ 它"的中断**（数值越大 = 优先级越低）。
> 所以 `BASEPRI = 0x50` 的效果是：**"中等和低优先级的中断都被挡住，只有最高那几档能进来"**。

### 4.2 为什么"优先级 0~4 的中断不能调 API"

| 中断优先级 | 会被 `taskENTER_CRITICAL()` 屏蔽吗 | 能调 `xxxFromISR()` 吗 |
| --- | --- | --- |
| **0 ~ 4** | ❌ **不能** | ❌ **绝对不能** |
| **5 ~ 15** | ✅ 能 | ✅ 能 |

**为什么 0~4 不能调 API**：

```
假设优先级 2 的中断调了 xQueueSendFromISR()
    → 内核在里面操作队列链表
    → 这时中断打断了一个正在操作同一个链表的临界区（因为 2 < 5，不受 BASEPRI 屏蔽）
    → 链表指针被改坏 → 内核崩溃
```

**所以 FreeRTOS 的设计是**：**"我把 5~15 都管住了（用 BASEPRI），0~4 我管不住，所以你们别调我的 API"**。

> **这条规则在工程里的实际含义**：
> **凡是要调 `xxxFromISR()` 的中断，`nvic_irq_enable(irq, pre, sub)` 的 `pre` 必须 ≥ 5。**
> 本工程 `msp_exti.c` 里是 `nvic_irq_enable(nvic_irq, 2, 2)` —— **`pre = 2`，所以 EXTI 中断里绝不能调 `xxxFromISR()`**。
> 现在 EXTI 里只置标志（第 31 篇），**正好合规** ✅ —— 这个"巧合"其实是被逼出来的正确设计。

### 4.3 实验：关中断后串口还能不能收（`39add3e`）

**改动**：

```c
// msp_uart.c
- nvic_irq_enable(huart->usartx_irqn, 2, 2);
+ nvic_irq_enable(huart->usartx_irqn, 6, 0);   // ★ 6 > 5

// main.c（按键回调）
if (key == KEY1) { printf("disable interrupts\n"); portDISABLE_INTERRUPTS(); }
else if (key == KEY2) { printf("enable interrupts\n"); portENABLE_INTERRUPTS(); }
```

**预期现象**：

| 操作 | 串口中断优先级 | 现象 | 原因 |
| --- | --- | --- | --- |
| 按 KEY1（关中断） | **6**（≥5） | **串口收不到任何数据** | `portDISABLE_INTERRUPTS()` 写 `BASEPRI = 0x50`，6 ≥ 5 → 被屏蔽 |
| 按 KEY1（关中断） | 改成 **2**（<5） | **串口照常收** | 2 < 5 → **不受 BASEPRI 影响** |
| 按 KEY2（开中断） | 6 | 恢复正常 | `BASEPRI = 0` |

> **★ 这个实验的价值**：它把"抽象的数字 5"变成了**肉眼可见的现象**。
> 你在串口助手里敲字符，关中断后**一个都收不到** —— 这就是"中断被屏蔽"。
>
> **顺带一个坑**（提交信息里特意写了）：**"使用 `vTaskDelay` 会恢复中断"** ——
> 因为 `vTaskDelay` 内部会让出 CPU → 触发 `PendSV` 上下文切换 → **`portENABLE_INTERRUPTS()` 被调用**。
> 所以"想用 `portDISABLE_INTERRUPTS()` 演示长时间关中断"是做不到的：
> **任何阻塞调用都会把中断重新打开**。
>
> 这也说明 **`portDISABLE_INTERRUPTS()` 不是"给用户用的锁"**，它是内核内部用的。
> 用户该用 `taskENTER_CRITICAL()`（它有嵌套计数，不会被"意外恢复"）。

**同一个提交里还有一处改动值得注意**：

```c
- vTaskDelay(pdMS_TO_TICKS(1));      // app_task 里
+ delay_1ms(1);                       // 改成忙等
- vTaskDelay(100);                    // task_keys_scan 里
+ delay_1ms(100);                     // 改成忙等
```

**为什么把 `vTaskDelay` 换成 `delay_1ms`（忙等）？**

> **因为 `app_task` 的优先级是 3，而 `task1/2/3` 是 2。**
> 如果 `app_task` 用 `vTaskDelay(1)`，它每 1 ms 让出 CPU → 低优先级任务能跑。
> 如果改成 `delay_1ms(1)` **忙等**，**`app_task` 就一直占着 CPU** → **`task1/2/3` 全被饿死**。
>
> **这正是"要观察中断行为时，先排除调度干扰"的实验手法** ——
> 把"会切换任务的地方"改成"不切换"，让现象更干净。

### 4.4 三种"临界区"的区别

| API | 关的是什么 | 能嵌套吗 | 谁能调 | 典型用途 |
| --- | --- | --- | --- | --- |
| **`taskENTER_CRITICAL()` / `taskEXIT_CRITICAL()`** | 屏蔽 ≥5 的中断（`BASEPRI`） | ✅ 有嵌套计数 | **任务上下文** | 保护共享变量（几条指令） |
| `taskENTER_CRITICAL_FROM_ISR()` / `..._EXIT_...` | 同上，但**保存/恢复中断状态** | ✅ | **中断上下文** | ISR 里保护数据 |
| **`portDISABLE_INTERRUPTS()` / `portENABLE_INTERRUPTS()`** | 同上，**但没有嵌套计数** | ❌ | 内核内部 | **别在应用里用**（会被任何阻塞调用"意外打开"） |
| `vTaskSuspendAll()` / `xTaskResumeAll()` | **只关调度器，不关中断** | ✅ | 任务上下文 | 保护"任务之间"的数据，**中断仍能响应** |

> **★ 最后一行是个容易被忽略的选项**：
> **如果你只需要"防止任务切换"，不需要"防止中断"，用 `vTaskSuspendAll()` 代价更小**
> （中断照常响应，只是任务不切换）。
> **判断方法**：**"这段数据会被中断改吗？"**
> 会 → 用 `taskENTER_CRITICAL`；不会（只被其他任务改）→ 用 `vTaskSuspendAll` 或互斥量。

---

## 五、软件定时器（`e6fa686`）

### 5.1 它是"一个任务 + 一个命令队列"

```c
TimerHandle_t timer1_handle, timer2_handle;
uint8_t timer1_id = 1, timer2_id = 2;

void timer_callback(TimerHandle_t xTimer)
{
    uint8_t id = *((uint8_t *)pvTimerGetTimerID(xTimer));   // ★ 从 ID 区分是哪个定时器
    if (id == 1)      printf("timer1 callback\n");
    else if (id == 2) printf("timer2 callback\n");
}

// 创建
timer1_handle = xTimerCreate("timer1",
                             pdMS_TO_TICKS(1000),      // 周期 1000 ms
                             pdTRUE,                   // ★ 周期性（pdFALSE = 单次）
                             &timer1_id,               // 定时器 ID（指针）
                             (TimerCallbackFunction_t)timer_callback);

timer2_handle = xTimerCreate("timer2", pdMS_TO_TICKS(2000), pdTRUE, &timer2_id, timer_callback);

// 按键控制
if (key == KEY1) xTimerStart(timer1_handle, 0);   // 0 = 不阻塞（命令入队失败也立刻返回）
if (key == KEY2) xTimerStop(timer1_handle, 0);
if (key == KEY3) xTimerStart(timer2_handle, 0);
```

**内部结构**（这张图能解释 90% 的疑问）：

```
    你的任务                    定时器服务任务（Daemon Task）
  ┌──────────┐   命令队列      ┌──────────────────────────┐
  │xTimerStart├──────────────►│ 1. 收到 "start" 命令      │
  └──────────┘  (timer queue)  │ 2. 把定时器挂到"到期时间"  │
                              │    有序链表上              │
                              │ 3. 到期了 → 调 callback()  │
                              └──────────────────────────┘
                                        ↑
                              由 configTIMER_TASK_PRIORITY = 2 决定
```

**四条必须知道的规则**：

| 规则 | 说明 |
| --- | --- |
| **① 回调运行在"定时器服务任务"里** | **不是中断**，但**也不是你的任务**。所以回调里**不能调 `vTaskDelay()`**（会让整个定时器服务停摆，所有软件定时器都延迟） |
| ② 回调要**短** | 同上。要做重活就 `xQueueSend` 给别的任务 |
| ③ **`xTimerStart(x, 0)` 的第二个参数是"阻塞时间"** | 传 0 = 命令入队失败立刻返回；传 `portMAX_DELAY` = 一直等到队列有空位。**在中断里只能用 `xTimerStartFromISR()`** |
| ④ 周期精度 = 1 tick | `pdMS_TO_TICKS(1000)` 在 1 kHz 下正好 1000 tick，**误差 ±1 tick** |

### 5.2 三种"定时"的对照

到这里，本工程有**三种做"周期性事情"的方式**了：

| | **硬件定时器**（07/21） | **软件定时器**（本篇） | **taskmanager**（33 篇） |
| --- | --- | --- | --- |
| 谁在计时 | TIMER0~13 硬件 | **SysTick 的 tick 计数** | **SysTick 的 tick 计数** |
| 精度 | **µs 级**（PSC 可调到 1 MHz） | 1 tick = **1 ms** | 1 tick = **1 ms** |
| 回调上下文 | **中断** | **定时器服务任务** | 主循环（`app_task`） |
| 能阻塞吗 | ❌ | ❌（会拖垮所有软定时器） | ✅（但会拖垮整张表） |
| 数量限制 | 芯片有 14 个 | **不限**（受 heap 限制） | 表里几个就几个 |
| 需要额外任务吗 | ❌ | ✅ 一个 daemon 任务（`configTIMER_TASK_STACK_DEPTH = 260 words`） | ❌ |
| 适合 | **µs 级时序**（PWM、WS2812、超声波） | **秒级周期动作**（闪灯、超时、心跳） | 裸机时的手工调度 |

> **选择口诀**：
> **"微秒级 → 硬件定时器；毫秒/秒级 + 回调轻 → 软件定时器；裸机没 RTOS → 任务表。"**

---

## 六、三种信号量

### 6.1 二值信号量（`3acac6e`）

```c
SemaphoreHandle_t binary_Semaphore_Handle;

// 创建：初始为空（0），所以第一个 take 会一直等
binary_Semaphore_Handle = xSemaphoreCreateBinary();

void task1(void *pv)
{
    while (1)
    {
        xSemaphoreTake(binary_Semaphore_Handle, portMAX_DELAY);   // 等到有信号
        printf("1");
        vTaskDelay(pdMS_TO_TICKS(300));
    }
}

void task2(void *pv)   // 一样，但 delay(500)
{
    while (1)
    {
        xSemaphoreTake(binary_Semaphore_Handle, portMAX_DELAY);
        printf("2");
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}

void task3(void *pv)   // ★ 对照组：不 take
{
    while (1) { printf("3"); vTaskDelay(pdMS_TO_TICKS(1000)); }
}

void on_key_press(KEY_NUM key)
{
    if (key == KEY1) xSemaphoreGive(binary_Semaphore_Handle);   // ★ 按一下给一次
}
```

**现象**：
- `task3` 每秒打印一个 `3`（不受信号量影响）
- **每按一次 KEY1，才打印一个 `1` 或 `2`**（谁先被唤醒就打印谁）

**这就是二值信号量的两种典型用法**：

| 用法 | 语义 |
| --- | --- |
| **事件通知**（本实验） | "某件事发生了" → 唤醒**一个**等待者 |
| **互斥（不推荐）** | 当"锁"用 —— **但二值信号量没有"所有权"，不能做优先级继承**（见 6.3） |

**★ 注意 `xSemaphoreTake` 之后**没有** `Give` 回去** —— 因为这里是"消耗事件"，不是"用锁"。
这正好和二值信号量"计数上限 = 1"的特性吻合：**给一次、拿一次，就空了**。

### 6.2 计数信号量（`5d97c6d`）

```c
counting_Semaphore_Handle = xSemaphoreCreateCounting(5, 3);
//                                              ↑最大  ↑初始值

if (key == KEY1) xSemaphoreGive(counting_Semaphore_Handle);            // 给 1 个
else if (key == KEY2)
{
    xSemaphoreGive(counting_Semaphore_Handle);   // 连给 5 个
    xSemaphoreGive(counting_Semaphore_Handle);
    xSemaphoreGive(counting_Semaphore_Handle);
    xSemaphoreGive(counting_Semaphore_Handle);
    xSemaphoreGive(counting_Semaphore_Handle);
}
```

**与二值的区别**：

| | 二值 | 计数（5, 3） |
| --- | --- | --- |
| 初始值 | 0 | **3** |
| 上限 | **1** | **5** |
| 连续 `Give` | 第 2 次**失败**（已经是 1 了） | 可以累加，**到 5 才失败** |
| 一次能给几个任务放行 | **1 个** | **最多 5 个** |

**典型用途**：

| 场景 | 为什么用计数 |
| --- | --- |
| **生产者-消费者**（缓冲区有 N 个空位） | 每放一个数据 `Give` 一次，消费者取走一个 `Take` 一次 |
| **资源池**（5 个内存块 / 5 个 DMA 通道） | 初始值 = 资源数，用完归还 |
| **事件计数**（来了 3 个脉冲） | 计数不会丢事件（二值会丢） |

> **`xSemaphoreCreateCounting(5, 3)` 的初始值 3 很关键**：
> 它意味着"**已经有 3 个资源可用**"，所以上电后 `task1` 和 `task2` 会**立刻各消耗一个**（打印 `1`、`2`），
> 然后还剩 1 个 → 第三个等待者也能立刻跑。
> **如果初始值写 0，就必须先按键才能跑**。

### 6.3 互斥量（`d69c991`）

```c
SemaphoreHandle_t mutex_Semaphore_Handle = xSemaphoreCreateMutex();

void task1(void *pv)
{
    while (1)
    {
        xSemaphoreTake(mutex_Semaphore_Handle, portMAX_DELAY);
        printf("1");                                        // ← 临界区（被保护的部分）
        xSemaphoreGive(mutex_Semaphore_Handle);             // ★ 谁拿谁还
        vTaskDelay(pdMS_TO_TICKS(300));
    }
}
```

**互斥量 vs 二值信号量（★ 这是最容易搞混的一对）**：

| | 二值信号量 | **互斥量** |
| --- | --- | --- |
| 初始值 | 0（通常是"等事件"） | **1**（"锁是开的"） |
| **有所有权吗** | ❌ 谁都能 Give（包括没 Take 的任务、ISR） | ✅ **只有 Take 的那个任务能 Give** |
| **优先级继承** | ❌ **没有** | ✅ **有**（关键区别） |
| 能用在中断里吗 | ✅（`FromISR` 版本） | ❌ **绝对不行**（ISR 没有"任务身份"） |
| 典型用途 | 事件通知、任务同步 | **保护共享资源**（I2C 总线、SPI、printf） |

**★ 什么是"优先级继承"，为什么它重要**：

```
三个任务：H（高，优先级 5）、M（中，3）、L（低，1）
L 拿到了互斥量，正在用 I2C
    ↓
H 就绪，抢占 L，但 H 也要用 I2C → 被互斥量挡住，阻塞
    ↓
M 就绪（优先级 3 > L 的 1）→ 抢占 L
    ↓
★★ L 拿不到 CPU → 永远不释放锁 → H 永远等 → "优先级反转"
```

**优先级继承的做法**：

```
当 H 因为等 L 持有的锁而阻塞时，
    → 内核临时把 L 的优先级"提升"到 H 的级别
    → M 就抢不过 L 了
    → L 能尽快跑完、释放锁
    → L 的优先级恢复原值
```

> **二值信号量做不到这一点**（它不知道"锁是谁持有的"），所以 **"用二值信号量当锁"是经典错误**。

**⚠️ 本实验的演示效果其实很弱**：

```c
xSemaphoreTake(mutex, portMAX_DELAY);
printf("1");                    // ← 这里只有"一个字符"，本身就接近原子
xSemaphoreGive(mutex);
```

**`printf("1")` 只有 1 个字符**，而且 `task1` 和 `task2` 的 `Take` 之间没有"会被打断的长操作"
→ **即使不加互斥量，你也很可能看不到交错**。

> **要真正演示互斥量的必要性，应该**：
> ① 让临界区**变长**（比如 `printf("task1 start..."); delay_1ms(50); printf("end\n")`）；
> ② 或者**真的去操作 I2C**（几百 µs，一定会被切换打断）。
> **本工程的实验代码目前只是"把 API 跑通"，还不是"能观察到问题的实验"** —— 这是可以改进的地方。

### 6.4 ★ 三者对照总表

| 维度 | **二值信号量** | **计数信号量** | **互斥量** |
| --- | --- | --- | --- |
| 创建 | `xSemaphoreCreateBinary()` | `xSemaphoreCreateCounting(max, init)` | `xSemaphoreCreateMutex()` |
| 取值 | 0 / 1 | 0 ~ max | 0 / 1 |
| 初始 | 0（空） | 自定义 | **1（开）** |
| 所有权 | ❌ | ❌ | ✅ |
| 优先级继承 | ❌ | ❌ | ✅ |
| 中断里能用 | ✅ `FromISR` | ✅ `FromISR` | ❌ |
| 语义 | "**事件发生了**" | "**有 N 个资源/事件**" | "**这把锁归我了**" |
| 本工程用在哪 | 按键触发任务 | 资源池演示 | **将来给 I2C/SPI 用**（遗留） |
| 用错的后果 | 当锁用 → **优先级反转** | 上限算错 → 死锁/丢事件 | **在 ISR 里用 → 崩溃** |

---

## 七、9 个实验汇总表

| # | 提交 | 时间 | API | 观察点 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | `1a8efcb` | 10-20 21:11 | `xTaskCreate(..., 2/3, ...)` | 只打印 task2 | **高优先级无 delay → 低优先级饿死** |
| 2 | `d0fdec4` | 10-20 21:28 | `vTaskSuspend` / `vTaskResume` | 按键后 task1 停/续 | 挂起态**不消耗 tick** |
| 3 | `567aead` | 10-20 21:50 | 无 | `n < 2000000` | **读-改-写竞态**，`-O0` 下稳定复现 |
| 4 | `2fa56a8` | 10-20 21:51 | `taskENTER/EXIT_CRITICAL` | `n == 2000000` | 关中断 → **任务无法切换** |
| 5 | `39add3e` | 10-21 10:00 | `nvic_irq_enable(...,6,0)` + `portDISABLE/ENABLE_INTERRUPTS` | 关中断后串口收不到 | **`BASEPRI` 只屏蔽 ≥5 的中断** |
| 6 | `e6fa686` | 10-21 10:59 | `xTimerCreate/Start/Stop` | 1 s / 2 s 回调 | 回调在**定时器服务任务**里 |
| 7 | `3acac6e` | 10-21 11:13 | `xSemaphoreCreateBinary` | 按键才打印 | 一次 Give **只放行一个** |
| 8 | `5d97c6d` | 10-21 11:20 | `xSemaphoreCreateCounting(5,3)` | 连 give 可累计 | 上限 5，**初始 3** |
| 9 | `d69c991` | 10-21 11:26 | `xSemaphoreCreateMutex` | 互斥访问 printf | **有所有权**（但演示效果弱） |
| — | `6a313c5` | 10-21 11:32 | —— | —— | 补注释 |
| — | `193555f` | 10-21 12:57 | —— | —— | 9 个实验合并入 `main` |

**这 9 个实验在"知识地图"上的位置**：

```
         ┌── 调度（谁能跑）── 优先级(1) / 挂起(2)
FreeRTOS ┤
         └── 同步（一起跑怎么办）
                ├── 临界区 ── 无保护(3) / 有保护(4) / 边界(5)
                ├── 定时   ── 软件定时器(6)
                └── 信号量 ── 二值(7) / 计数(8) / 互斥(9)
```

---

## 八、遗留问题与隐患

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| **1** | **`task3` 里 `vTaskDelete(task2_handle)`** | `main.c` | **复制粘贴错误**，应该是 `task3_handle`。因为 `while(1)` 不退出，**永远不会执行到**，所以不炸 |
| **2** | **测试代码占了 `main.c` 一大半** | `main.c` | `task1/2/3` 是实验用的，**不是产品功能**。正式版应挪进 `App/app_test/` 或删掉 |
| **3** | **9 个实验只保留了最后一个** | —— | 因为都在 `main.c` 里改来改去，**前面 8 个实验的代码只能从 git 历史里看**（这也是本笔记要逐提交读 diff 的原因） |
| **4** | **没有 `FromISR` 的实战** | —— | 9 个实验里**没有一个在中断里调 `xxxFromISR()`**（因为 EXTI 优先级是 2 < 5，调了就是错的）。**"中断发给任务"这条链路还没验证过** |
| **5** | **互斥量演示效果弱** | `d69c991` | 临界区只有 `printf("1")` 一个字符，看不出交错（§6.3 末尾） |
| **6** | **`configMAX_TASK_NAME_LEN = 10`** | config | `"task_keys_scan"` 被截断成 `"task_keys"`（第 34 篇遗留 #3） |
| **7** | **所有任务栈 128 words = 512 B** | `main.c` | `printf("timer1 callback\n")` 这种格式化调用**很吃栈**，512 B 偏紧 |
| **8** | **按键扫描周期 100 ms** | `task_keys_scan` | 按键响应最慢 100 ms（裸机 EXTI 版是 30 ms 消抖）。**信号量触发有可感延迟** |
| **9** | **`xSemaphoreCreateMutex()` 没检查返回值** | `main.c` | 返回 `NULL`（堆不够）时，后面 `xSemaphoreTake(NULL)` 会崩溃 |
| **10** | **`portDISABLE_INTERRUPTS()` 用在应用层** | `39add3e` | 它是内核内部 API，**任何阻塞调用都会把它打开的**（§4.3）。实验后就该删掉 |
| **11** | **`delay_1ms` 忙等仍在用** | `39add3e` 引入 | `app_task` 和 `task_keys_scan` 里改成了忙等，**实验目的达到了但代码没改回去** |
| **12** | **中断优先级仍不统一** | 全局 | EXTI 是 2、USART 曾被改成 6（实验后又改回 2）。**没有一个"工程统一的优先级表"** |

> **第 12 条值得单独说**：**一个 RTOS 工程必须有"中断优先级表"**。
> 因为"能不能调 API"完全取决于优先级数值，**散落在各个 `nvic_irq_enable()` 里迟早出事**。
> 本工程现在的情况：
>
> | 中断 | 优先级 | 能调 FromISR 吗 |
> | --- | --- | --- |
> | EXTI0/3/5/8/11/15 | **2** | ❌ 不能 |
> | USART0/2 | **2**（实验时曾改 6） | ❌ 不能 |
> | SysTick / PendSV | **0xF0**（内核） | —— |
>
> **好消息**：现有中断都只置标志，**没有违反规则** ✅
> **坏消息**：**将来想在任何中断里发队列/信号量，都必须先把优先级改成 ≥5**，而这件事没有记在任何文档里。

---

## 九、参数速查表 / 排查清单

### 9.1 参数速查

| 项目 | 值 | 出处 |
| --- | --- | --- |
| tick 频率 | **1000 Hz**（1 tick = 1 ms） | `configTICK_RATE_HZ` |
| 可调 API 的最高优先级 | **5** | `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` |
| `BASEPRI` 值 | **0x50** | `5 << 4` |
| 内核中断优先级 | **0xF0** | `0xF << 4` |
| 优先级分组 | **`PRE4_SUB0`** | `main.c` |
| 优先级数 | **5**（0~4） | `configMAX_PRIORITIES` |
| `app_task` 优先级 | **3** | `tskIDLE+3` |
| `task1/2/3` 优先级 | **2** | `xTaskCreate` |
| `task_keys_scan` 优先级 | **3** | `xTaskCreate` |
| 定时器服务任务优先级 | **2** | `configTIMER_TASK_PRIORITY` |
| 定时器服务任务栈 | **260 words = 1040 B** | `configMINIMAL_STACK_SIZE * 2` |
| 互斥量初始值 | **1** | `xSemaphoreCreateMutex()` |
| 计数信号量 | **max=5, init=3** | 实验 8 |
| 软件定时器周期 | timer1 = **1000 ms**、timer2 = **2000 ms**，均周期型 | 实验 6 |
| 按键扫描周期 | **100 ms** | `task_keys_scan` |
| 竞态实验次数 | 2 × **1 000 000** 次 | 实验 3/4 |
| 竞态实验优化等级 | **`-O0`**（`level-0`） | 实验 3/4 的 `eide.yml` / `uvprojx` |
| 中断优先级（当前） | EXTI/USART 均为 **2**（**不能调 `FromISR`**） | `msp_exti.c` / `msp_uart.c` |

### 9.2 排查清单

| # | 现象 | 最可能的原因 | 怎么查 |
| --- | --- | --- | --- |
| **1** | **某个任务永远不跑** | 高优先级任务没有阻塞点（**饥饿**） | 给高优先级任务的 `while(1)` 加 `vTaskDelay`；或用 `uxTaskGetSystemState()` 看各任务状态 |
| **2** | 系统整体卡死，只有最高优先级任务在跑 | 同上 | 同上 |
| **3** | **共享变量偶尔算错** | 缺临界区/互斥量（读-改-写竞态） | 用实验 3 的方法复现（`-O0` + 1e6 次） |
| **4** | **中断里调 `xxxFromISR()` 后死机** | 该中断优先级 **< 5** | 查 `nvic_irq_enable(irq, pre, sub)`；`pre` 必须 ≥ 5 |
| **5** | **临界区"好像没生效"** | 优先级分组不是 `PRE4_SUB0` | 查 `nvic_priority_group_set()`（第 34 篇 §3.5） |
| **6** | 关了中断但中断还在进 | 那个中断优先级 **< 5**（不受 `BASEPRI` 管） | 同上，看优先级数值 |
| **7** | 用 `portDISABLE_INTERRUPTS()` 后马上就"恢复"了 | **任何阻塞调用（`vTaskDelay`/`Take`）都会把它打开** | 改用 `taskENTER_CRITICAL()` |
| **8** | 临界区里 `return` 了 → 系统假死 | **没 `taskEXIT_CRITICAL()`** | grep 配对；用 `{}` 块包起来 |
| **9** | **软件定时器回调里卡死** | 回调里调了 `vTaskDelay()` / 长阻塞 | 回调必须短；重活 `xQueueSend` 给任务 |
| **10** | 软件定时器不触发 | 忘了 `xTimerStart()`（**只 Create 不会跑**） | 查是否调了 Start |
| **11** | `xTimerStart(x, 0)` 偶发失败 | 定时器命令队列满（`configTIMER_QUEUE_LENGTH = 10`） | 看返回值；或改大队列 |
| **12** | **信号量 take 一直等不到** | ① 二值信号量初始为 **0**，没人 Give；② 计数信号量初始值写 0；③ Give 的任务没跑 | 查创建时的初始值 |
| **13** | **用二值信号量当锁 → 偶发卡死** | **优先级反转**（二值无优先级继承） | 换 `xSemaphoreCreateMutex()` |
| **14** | 互斥量在中断里用 → 崩溃 | ISR 没有任务身份，**不能 Take/Give 互斥量** | 改用 `xSemaphoreGiveFromISR` + 二值/计数 |
| **15** | 按键响应慢（100 ms 级） | 扫描周期 100 ms | 改小周期，或改用 EXTI（注意优先级 ≥5 才能 `FromISR`） |
| **16** | `xSemaphoreTake(NULL, ...)` 崩溃 | `xSemaphoreCreate*()` 返回 NULL（堆不够） | 检查返回值；看 `xPortGetFreeHeapSize()` |

---

## 十、自测题 + 练习题

### 10.1 自测题

1. 为什么"高优先级任务不加 `vTaskDelay()`"会让低优先级任务永远不跑？裸机任务表里同样写法会怎样？
2. `vTaskSuspend` 和 `vTaskDelay` 的区别？被挂起的任务还消耗 tick 吗？
3. `n++` 和 `j = n+1; n = j;` 在竞态实验里有什么区别？为什么要把优化等级降到 `-O0`？
4. `taskENTER_CRITICAL()` 到底做了什么？为什么它能让"两个任务不交错"？
5. **`BASEPRI = 0x50` 时，哪些中断被屏蔽、哪些不被屏蔽？为什么方向是"数值 ≥5 被屏蔽"？**
6. **为什么优先级 0~4 的中断里绝对不能调 `xxxFromISR()`？**
7. `portDISABLE_INTERRUPTS()` 为什么"一调 `vTaskDelay` 就恢复了"？
8. `vTaskSuspendAll()` 和 `taskENTER_CRITICAL()` 的区别？什么时候该用前者？
9. 软件定时器的回调运行在哪个上下文？为什么不能在回调里 `vTaskDelay()`？
10. 二值信号量、计数信号量、互斥量三者最本质的区别是什么？（提示：所有权）
11. 什么是优先级反转？互斥量怎么解决它？为什么二值信号量不行？
12. `xSemaphoreCreateCounting(5, 3)` 的两个参数分别是什么？初始值写 3 会导致什么？
13. 本工程现在所有中断都是优先级 2 —— 这对"在中断里发信号量"意味着什么？

### 10.2 练习题

1. **复现饥饿**：把 `task1` 的 `vTaskDelay` 去掉（`task2` 保留），观察串口输出变化；再用 `uxTaskGetSystemState()` 打印各任务状态，看 `task1` 是"就绪"还是"运行"。
2. **改临界区粒度**：把实验 3 的 `taskENTER_CRITICAL()` 移到 `for` 循环外面（整个 100 万次都在临界区里），观察串口是否还能正常输出、按键是否还有反应——**体会"临界区太长"的代价**。
3. **测关中断时长**：在 `taskENTER_CRITICAL()` 前后翻转一个 GPIO，用示波器量高电平宽度，算出"每次循环关中断多少 µs"。
4. **做真正的 `FromISR` 实验**：把 EXTI0 的优先级改成 6，在 `EXTI0_IRQHandler` 里用 `xSemaphoreGiveFromISR()` + `portYIELD_FROM_ISR()`，让一个任务等这个信号量——**这是本工程唯一还缺的一环**。
5. **用互斥量保护 I2C**：创建互斥量，在 `msp_iic_write_nbyte` / `read_nbyte` 前后 take/give，然后让 OLED 任务和 PCF8563 任务同时跑，对比"加锁/不加锁"的花屏频率。
6. **软件定时器做心跳**：用 `xTimerCreate` 建一个 500 ms 周期定时器，回调里翻转 LED；再用 `vTaskDelay` 的任务做同样的事，比较两者的抖动（示波器）。
7. **优先级反转实验**：三个任务 H/M/L + 一个互斥量，先复现"L 拿着锁被 M 抢占、H 饿死"，再把互斥量换成二值信号量对比。
8. **数一遍栈**：给 `task1` 加 `printf("%d %d %d ...")`（多参数格式化），把栈从 128 降到 64，看是否崩溃（需先开 `configCHECK_FOR_STACK_OVERFLOW = 2`）。
9. **整理成测试集**：把 9 个实验从 `main.c` 拆成 `App/app_test/freertos_test.c`，用 `#define TEST_CASE_x` 选择编译——这就是 `193555f` 那个"测试集"应该有的形态。

---

## 附：提交清单

| # | 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- | --- |
| 1 | `1a8efcb` | 10-20 21:11 | [更新] 任务优先级测试 | `task1`/`task2` 都改成 `printf` 死循环（无 delay）；优先级 2 vs **3**；`nvic_priority_group_set` 改 `PRE4_SUB0`；`task_led*_handler` → `_handle` |
| 2 | `d0fdec4` | 10-20 21:28 | [更新] 任务优先级测试 任务挂起与恢复 | `task2` 加 `vTaskDelay(1000)`（修饥饿）；新增 `task_keys_scan`（100 ms）；`on_key_press`：KEY1 `vTaskSuspend`、KEY2 `vTaskResume` |
| 3 | `567aead` | 10-20 21:50 | [更新] 临界区测试 **没有临界区保护** | `n` 全局 + 两任务各 100 万次 `j=n+1; n=j;`；**优化等级改 `-O0`** |
| 4 | `2fa56a8` | 10-20 21:51 | [更新] 临界区测试 **有临界区保护** | 在 `j=n+1; n=j;` 外面加 `taskENTER_CRITICAL()` / `taskEXIT_CRITICAL()` |
| 5 | `39add3e` | 10-21 10:00 | [更新] **中断优先级测试** | `msp_uart`：`nvic_irq_enable(..., 2, 2)` → **`(..., 6, 0)`**；KEY1 `portDISABLE_INTERRUPTS()`、KEY2 `portENABLE_INTERRUPTS()`；`app_task`/`task_keys_scan` 的 `vTaskDelay` → `delay_1ms`（忙等）；优化等级回 `-O1` |
| 6 | `e6fa686` | 10-21 10:59 | [更新] 软件定时器测试 | `timer1`（1000 ms）/`timer2`（2000 ms）周期型；`pvTimerGetTimerID()` 区分；KEY1/2/3 控 Start/Stop |
| 7 | `3acac6e` | 10-21 11:13 | [更新] **二值信号量测试** | `xSemaphoreCreateBinary()`；`task1/2` take、`task3` 对照；KEY1 `xSemaphoreGive()` |
| 8 | `5d97c6d` | 10-21 11:20 | [更新] **计数信号量测试** | `xSemaphoreCreateCounting(5, 3)`；KEY1 给 1 个、KEY2 连给 5 个 |
| 9 | `d69c991` | 10-21 11:26 | [更新] **互斥信号量测试** | `xSemaphoreCreateMutex()`；`task1/2` take → printf → give |
| 10 | `6a313c5` | 10-21 11:32 | [整理] 补充整理注释 | 各任务补充注释（"让出 CPU 给其他任务，与 `delay_1ms` 忙等不同"等） |
| 11 | `193555f` | 10-21 12:57 | [合并] **FreeRTOS 同步与中断机制验证测试集** | 把 9 个实验合成一个测试集合入 `origin/main`；同时改 `msp_uart.c` 1 行、`FreeRTOSConfig.h`（格式化）、`README.md` +286/-93 |

**这一轮的"台阶"**

| 台阶 | 提交组 | 解决了什么 |
| --- | --- | --- |
| 1. 验证调度 | `1a8efcb` `d0fdec4` | 搞清"优先级/挂起"到底怎么影响执行 |
| 2. 验证并发 | `567aead` `2fa56a8` `39add3e` | **亲手复现竞态，再用临界区修掉**；搞清 `BASEPRI` 边界 |
| 3. 验证通信/定时 | `e6fa686` `3acac6e` `5d97c6d` `d69c991` | 三种信号量 + 软件定时器各跑通一遍 |

> **这一轮的价值不在"代码"，而在"现象"**：
> **`n` 从 100 万零几百变成 200 万、串口在关中断后彻底静默** ——
> 这两个现象，比读十遍文档更能让人记住"竞态"和"`BASEPRI`"是什么。

---

## 参考笔记

- **`../GD32F407_myLibrary/README.md`** §FreeRTOS 集成 —— 版本/port/heap/调度/中断优先级/异常映射的权威表格；§已知遗留 11 条。
- **`../GD32F407_myLibrary/Doc/FreeRTOS移植后卡死问题与修复.md`** —— 第 34 篇第五章的原始文档；本篇 §4.3 的"关中断"背景知识（SysTick 归内核）也来自它。
- **`Middleware/FreeRTOS/include/FreeRTOS.h`** —— `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` / `configMAX_SYSCALL_INTERRUPT_PRIORITY` 的官方注释（本篇 §4.1 的原文依据）。
- **`Middleware/FreeRTOS/portable/GCC/ARM_CM4F/portmacro.h`** —— `portENTER_CRITICAL()` / `portDISABLE_INTERRUPTS()` 的**宏展开**（能看到它到底写了哪个寄存器）。
- **`Middleware/FreeRTOS/timers.c`** —— 软件定时器服务任务的实现（`prvTimerTask`），能验证本篇 §5.1 那张图。
- **`Middleware/FreeRTOS/queue.c`** —— 信号量的底层就是队列（`xQueueGenericSend/Receive`），互斥量的优先级继承在 `xQueueGiveMutexRecursive`/`xTaskPriorityInherit`。
- `../../../NOTE/Note/TASK.md` §4.6「从裸机多任务到 RTOS」—— 与第 33/34 篇配套。

> **关于教材**：`ARM/NOTE/Textbook/` 里没有 FreeRTOS 章节的可读快照，本篇依据是 FreeRTOS 官方源码 + 本工程配置与实验代码。
>
> 本笔记仅作学习整理，内容来自本仓库真实提交记录与源码。
