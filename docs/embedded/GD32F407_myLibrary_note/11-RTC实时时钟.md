# 11 · RTC 实时时钟 · 学习笔记

> 这一篇覆盖 **3 次提交**：`7ff9b34`（在 `main.c` 里裸写 RTC，用外部高速晶振当 RTC 时钟源）→ `e37d8db`（加闹钟中断）→ `7107a78`（封装成 `Hardware/msp_rtc`，时钟源参数化）。
> 三次提交都在 `main` 分支上，**已合并**。`main` 的当前 HEAD 是 `bbce6b7`（第 12 篇）。
> 整理日期：2026-09-26　｜　提交范围：`7ff9b34`、`e37d8db`、`7107a78`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想让 RTC 走起来 | 第二章（时钟源）+ 第四章（预分频计算）+ 第九章速查表 |
| **时钟不走字 / 走得太快太慢** | 第四章 4.3 节的对照表 + 第十章排查清单前 4 条 |
| 闹钟触发时机不对 | 第八章「mask 是「忽略」不是「启用」」，这是本篇最容易踩的坑 |
| 想理解「为什么要先重置备份域」 | 第二章 2.3 节 |
| 准备面试 | RTC 的三个时钟源、BCD 编码、备份域与 VBAT 是高频考点 |

## 知识点地图

```
RTC 实时时钟
├── RTC 是什么          本质是「1 秒计数器」，靠秒换算出年月日时分秒
├── 日历数据格式        BCD 码（亚秒用二进制），DEC2BCD / BCD2DEC 宏
├── 时钟源（三种）      HXTAL÷25=320kHz / LXTAL 32.768kHz / IRC32K 32kHz
├── 预分频器            7 位异步 FACTOR_A + 15 位同步 FACTOR_S，目标是 CK_SPRE = 1 Hz
├── 备份域与 VBAT       RTC 核心在备份域，掉电靠 VBAT 维持；写保护需 PMU 解除
├── 备份域重置          rcu_bkp_reset_enable()，能解决「不走字」但会清空 BKP 寄存器
├── 影子寄存器同步      rtc_register_sync_wait()，配置完必须等
├── 读时间              rtc_current_time_get() + BCD2DEC 逐字段转换
├── 写时间              rtc_init() 一次性配置 + 5 个预分频/格式字段
├── 闹钟 Alarm          RTC_ALARM0 + alarm_mask「忽略」语义 + 中断
└── 闹钟中断链路        RTC 闹钟 → EXTI_17 → RTC_Alarm_IRQn → RTC_Alarm_IRQHandler
```

## 学习目标

- 说清 RTC 的本质（1 秒计数器）以及为什么必须提供 1 Hz
- 掌握三种 RTC 时钟源的差别，会给任意输入时钟算异步/同步预分频值
- 理解 BCD 码为什么在 RTC 里用（而不是普通二进制）
- 明白备份域、VBAT、写保护三者的关系，知道 `rcu_bkp_reset_enable()` 的副作用
- 会配 RTC 的读、写、闹钟，并能把闹钟中断链路完整跑通
- 知道 `alarm_mask` 是「忽略该字段」而不是「启用该字段」

---

## 一、RTC 是什么

一句话：**RTC 本质就是一个「1 秒计数器」**——它数了多少秒，再换算成年月日时分秒。

```
你给它一个精确的 1 Hz 时钟
        ↓
它每来一个脉冲就把「秒」加 1
        ↓
硬件自动完成 60 秒→1 分、60 分→1 时、24 时→1 天 的进位
        ↓
你读它的时候，直接得到 BCD 格式的「年 月 日 时 分 秒」
```

**和定时器的区别**（别混）：

| | 定时器（TIMER，第 07 篇） | RTC |
| --- | --- | --- |
| 计时范围 | 微秒 ~ 秒级 | **年月日时分秒（带日历）** |
| 断电后 | 全部丢失 | **靠 VBAT 电池继续走** |
| 时钟源 | APB 总线时钟（168 MHz） | 32 kHz 级别的低速时钟 |
| 精度 | 高 | 取决于晶振（LXTAL 最准） |

**为什么需要「日历」这个硬件功能？** 因为纯软件换算日期要处理大小月、闰年、星期，很容易写错。**交给硬件做，你只管读**。

---

## 二、时钟源与硬件

### 2.1 RTC 原理图部分

| 项目 | 内容 |
| --- | --- |
| 外部低速晶振 | **32.768 kHz**（`SMD3215-2P`），接在 **PC14-OSC32IN / PC15-OSC32OUT** |
| 匹配电容 | **12 pF**（教材强调「已经过测试调整，需要负载电容 < 7 pF 的晶振」） |
| 备份电源 | **VBAT**，掉电时给备份域供电 |

> **为什么低速晶振偏偏是 32768 Hz？** 因为 `32768 = 2^15`，用 15 级二分频就能精确得到 1 Hz。这是所有实时时钟芯片的行业惯例。

### 2.2 三种 RTC 时钟源（本工程全都实现了）

头文件里定义成枚举，初始化时作为参数传进去：

```c
typedef enum {
    HXTAL = 0,     // 外部高速晶振 8 MHz，需要 ÷25 → 320 kHz
    LXTAL,         // 外部低速晶振 32.768 kHz
    IRC32K         // 内部 32 kHz 振荡器
} RTC_CLOCK_SOURCE;
```

| 时钟源 | 频率 | 是否需外接元件 | 精度 | 掉电后还在吗 |
| --- | --- | --- | --- | --- |
| **HXTAL** | 8 MHz（÷25 → 320 kHz） | 是（板载高速晶振） | 高 | ❌（主系统掉电就停） |
| **LXTAL** | 32.768 kHz | **是（需焊 32.768k 晶振 + 12 pF 电容）** | **最高** | ✅（VBAT 供电时仍在） |
| **IRC32K** | 32 kHz（内部 RC） | **不需要** | 低（RC 振荡器一致性差） | ❌ |

**本工程当前用的是 `HXTAL`**（`main()` 里 `msp_rtc_init(HXTAL)`）：

```c
msp_rtc_init(HXTAL);
```

**为什么不选 LXTAL？** 看教材那句提示——LXTAL 需要**焊上 32.768 kHz 晶振和两颗匹配电容**，而标准板可能没焊；而且教材明确提到「不重置备份域可能导致无法设置晶振，出现**不走字**情况」。**先用板上一定有的 HXTAL 把功能跑通，是稳妥的选择。**

> **代价要知道**：HXTAL 走的是 VDD 电源域的设备，**主电源掉电后 RTC 就停了**。想真正实现「断电继续走表」，必须换 LXTAL + 装 VBAT 电池。

### 2.3 备份域：RTC 能「记住时间」的原因

```
┌─────────────────── VDD 电源域 ───────────────────┐
│  CPU / APB 接口 / RTC 的控制寄存器                 │
│  ← 系统复位或从待机唤醒后，这部分会被复位           │
└──────────────────────────────────────────────────┘
┌──────────────── 备份域（Backup Domain）──────────┐
│  RTC 核心计数器 / 20 个 32 位备份寄存器(BKP)       │
│  ← 由 VBAT 供电，系统复位也不受影响                 │
└──────────────────────────────────────────────────┘
```

**两条推论**：

| 结论 | 说明 |
| --- | --- |
| 系统复位后，RTC 的时间还在 | 因为时间存在备份域里（前提是时钟源持续有效） |
| **改 RTC 配置前必须解除写保护** | 备份域默认被 PMU 保护着，要 `pmu_backup_write_enable()` |

**关于 `rcu_bkp_reset_enable()`**（本工程每次都调）：

```c
// 通过PMU解除备份域写保护
pmu_backup_write_enable();
// 备份域重置
rcu_bkp_reset_enable();
rcu_bkp_reset_disable();
```

教材的原话是「**不重置可能导致无法设置晶振，出现不走字情况**」——所以这一步是**排障用的关键动作**。

**但它有副作用**（教材专门警告过）：**备份域重置会把 20 个 BKP 寄存器一起清掉**。所以如果以后想实现「只配置一次时间」（把时间存进 BKP，上电先读 BKP 判断是否需要重新配置），**就不能在初始化里无条件调用它**。

---

## 三、提交演进

### 3.1 `7ff9b34`：在 `main.c` 里裸写（用 HXTAL）

**提交信息**：`[更新] 内部RTC，使用外部高速晶振为时钟源`（`main.c` +127 行）

这次提交把三个东西一次性放进了 `main.c`：**BCD 转换宏**、**时间结构体**、**三个函数**（config / read / write）。

```c
// 0x1A  0010 0110
// 26->0x26   26/10 = 2   26%10 = 6
#define DEC2BCD(val) ((((val) / 10) << 4) | ((val) % 10))
// 0x26->26  0x26>>4=2  0x26&0x0F = 6
#define BCD2DEC(val) (((val) >> 4) * 10 + ((val) & 0x0F))

// 日历时间结构体
typedef struct
{
    uint16_t year; // 年里包含世纪
    uint8_t month;
    uint8_t day;
    uint8_t week;
    uint8_t hour;
    uint8_t min;
    uint8_t sec;
} Time;

Time time;
```

**BCD 换算宏是怎么来的**（注释已经写得很清楚，这里再拆一遍）：

```
十进制 26 → 想存成 BCD：

DEC2BCD(26) = ((26 / 10) << 4) | (26 % 10)
            = (2 << 4) | 6
            = 0x20 | 0x06
            = 0x26          ← 高 4 位放十位，低 4 位放个位

BCD2DEC(0x26) = ((0x26 >> 4) * 10) + (0x26 & 0x0F)
              = (2 * 10) + 6
              = 26          ✅
```

**为什么 RTC 用 BCD 而不是普通二进制？** 因为**年月日时分秒是「给人看的十进制数字」**，用 BCD 存储时：

| 好处 | 说明 |
| --- | --- |
| 每位十进制数占固定的 4 bit | 读出来直接就是「几」，不用除法 |
| 显示时不需要转换 | 数码管（第 09 篇）按位驱动正好 |
| 和硬件手册上的寄存器定义一一对应 | 手册写的就是 `0x26` 表示 26 年 |

**代价**：做运算前必须转成十进制（本工程全靠那两个宏）。

**时钟源配置**（当时写死在 `msp_rtc_config()` 里）：

```c
// 打开PMU时钟
rcu_periph_clock_enable(RCU_PMU);
// 通过PMU解除备份域写保护
pmu_backup_write_enable();
// 备份域重置
rcu_bkp_reset_enable();
rcu_bkp_reset_disable();

// 打开RTC时钟
rcu_periph_clock_enable(RCU_RTC);
// 配置RTC时钟源 使用外部高速晶振
// 8000000 / 25 = 320000
rcu_rtc_div_config(RCU_RTC_HXTAL_DIV25);
rcu_rtc_clock_config(RCU_RTCSRC_HXTAL_DIV_RTCDIV);
// 等待影子寄存器同步
if (rtc_register_sync_wait() == ERROR)
{
    printf("rtc_register_sync_wait error\n");
    return;
}
printf("rtc_register_sync_wait ok\n");
```

**注意两个细节**：

| 细节 | 说明 |
| --- | --- |
| 用 HXTAL 时**没有** `rcu_osci_on(RCU_HXTAL)` | 因为 HXTAL 已经在 `SystemInit()` 里作为系统时钟源被打开了，**不需要二次开启**（教材的例子里那句是给「没把 HXTAL 当系统时钟」的场景用的） |
| **`rcu_rtc_div_config()` 在 `rcu_rtc_clock_config()` 之前** | 教材的顺序是反的（先 clock 后 div）。工程实测可用；两者都属于「先把时钟源和分频配好，再等影子寄存器同步」 |

**主循环里验证时间在走**（这一段后来被注释掉了，可以看出当时的调法）：

```c
    if (cnt == 50)
    {
        cnt = 0;
        // 读取RTC
        msp_rtc_read(&time);
        printf("sec=%d, min=%d, hour=%d\n", (int)time.sec, (int)time.min, (int)time.hour);
        printf("day=%d, week=%d, month=%d, year=%d\n", (int)time.day, (int)time.week, (int)time.month, (int)time.year);
    }
    delay_1ms(20);
```

**为什么是 `cnt == 50`**：`50 × 20 ms = 1 秒`，即**每秒打印一次**。这就是第 05 篇那套「主循环时间片」的老写法——用计数 × 固定延时凑出需要的周期。

### 3.2 `e37d8db`：加上闹钟中断

**提交信息**：`[更新] 内部RTC，闹钟中断`

这次提交实现了完整的中断链路，并顺手清掉了上一版里那段「注释掉的初始化模板」。

```c
void msp_rtc_alarm_config(void)
{
    rtc_alarm_struct alarm_struct;
    alarm_struct.alarm_mask = RTC_ALARM_DATE_MASK | RTC_ALARM_HOUR_MASK | RTC_ALARM_MINUTE_MASK;
    alarm_struct.weekday_or_date = RTC_ALARM_DATE_SELECTED;
    alarm_struct.alarm_day = 0x24;
    alarm_struct.alarm_hour = 0x15;
    alarm_struct.alarm_minute = 0x00;
    alarm_struct.alarm_second = 0x00;
    alarm_struct.am_pm = RTC_AM;

    rtc_alarm_config(RTC_ALARM0, &alarm_struct);

    // 清标志位
    rtc_flag_clear(RTC_FLAG_ALRM0);
    exti_flag_clear(EXTI_17);
    // 配置 NVIC 中断
    nvic_irq_enable(RTC_Alarm_IRQn, 2, 2);
    // 配置 EXTI 外部中断线
    exti_init(EXTI_17, EXTI_INTERRUPT, EXTI_TRIG_RISING);
    // 配置EXTI中断与使能
    exti_interrupt_flag_clear(EXTI_17); // EXTI线编号17是RTC闹钟
    exti_interrupt_enable(EXTI_17);
    // 配置RTC闹钟中断与使能
    rtc_flag_clear(RTC_FLAG_ALRM0);
    rtc_interrupt_enable(RTC_INT_ALARM0);

    rtc_alarm_enable(RTC_ALARM0);
}

// 闹钟中断处理函数
void RTC_Alarm_IRQHandler()
{
    if (exti_interrupt_flag_get(EXTI_17) == SET)
    {
        exti_interrupt_flag_clear(EXTI_17);
        rtc_flag_clear(RTC_FLAG_ALRM0);
        printf("============ alarm ============\n");
    }
}
```

**闹钟的「四件套」缺一不可**（这是本篇最实用的一个检查清单）：

| # | 要做的事 | 代码 | 漏了会怎样 |
| --- | --- | --- | --- |
| 1 | 配置闹钟时间 | `rtc_alarm_config(RTC_ALARM0, &alarm_struct)` | 没有比较值 |
| 2 | 打开 **RTC 侧**中断 | `rtc_interrupt_enable(RTC_INT_ALARM0)` | RTC 标志置位了，但不产生中断请求 |
| 3 | 打开 **EXTI** 线 | `exti_init(EXTI_17, ...)` + `exti_interrupt_enable(EXTI_17)` | **中断永远不来**（和第 06 篇按键 EXTI 同理，但更容易漏） |
| 4 | 打开 **NVIC** | `nvic_irq_enable(RTC_Alarm_IRQn, 2, 2)` | 请求到了 CPU，但 CPU 不理 |
| 5 | 使能闹钟 | `rtc_alarm_enable(RTC_ALARM0)` | 前面全配好了，但闹钟没开 |

> **为什么 RTC 闹钟要经过 EXTI？** 因为 RTC 属于「备份域」，它**没有自己的 NVIC 中断入口**。所以它的闹钟信号要先接到 **EXTI 第 17 线**（`EXTI_17` 是硬件固定的），再由 EXTI 去请求 NVIC。这是 RTC 中断比普通外设中断多出来的一环。
>
> 中断函数名仍然是固定的：**`RTC_Alarm_IRQHandler`**（在启动文件的中断向量表里写死）。

**清标志要清两个**：`exti_interrupt_flag_clear(EXTI_17)` 和 `rtc_flag_clear(RTC_FLAG_ALRM0)`。**EXTI 侧和 RTC 侧各有自己的标志位**，只清一个就会反复进中断。

### 3.3 `7107a78`：封装成 `Hardware/msp_rtc`

**提交信息**：`[更新] 内部RTC 封装`（新建 `Hardware/msp_rtc/msp_rtc.c/h`，`main.c` 净减 128 行）

这次提交的封装动作有三层含义：

**① 位置对了**：RTC 是**芯片内部**外设 → 放 `Hardware/`，前缀 `msp_`（第 01 篇的分层约定）。

**② 时钟源参数化**——这是最能体现「封装」价值的改动：

```c
static RTC_CLOCK_SOURCE rtc_clock_source = HXTAL;

void msp_rtc_init(RTC_CLOCK_SOURCE rcs)
{
    rtc_clock_source = rcs;
    // 初始化rtc
    msp_rtc_config(rcs);
    Time time = {0};
    msp_rtc_write(&time);
}
```

**为什么要用一个 `static` 变量记住时钟源？** 因为**预分频值取决于时钟源**，而写时间（`msp_rtc_write`）和配时钟（`msp_rtc_config`）是两次独立调用，后者必须知道前者选了什么：

```c
void msp_rtc_write(Time *time)
{
    rtc_parameter_struct rtc_initpara_struct;
    // 同步和异步预分频率320000/factor_asyn/factor_syn = 1
    // f_rtcclk/(f_a+1)/(f_s+1) = 1hz
    if (rtc_clock_source == HXTAL)
    {
        rtc_initpara_struct.factor_asyn = 0x7F; /* 0x0 - 0x7F  */
        rtc_initpara_struct.factor_syn = 0x9C3; /* 0x0 - 0x7FFF */
    }
    else if (rtc_clock_source == LXTAL)
    {
        rtc_initpara_struct.factor_asyn = 0x7F;
        rtc_initpara_struct.factor_syn = 0xFF;
    }
    else if (rtc_clock_source == IRC32K)
    {
        rtc_initpara_struct.factor_asyn = 0x7F;
        rtc_initpara_struct.factor_syn = 0xF9;
    }
    ...
}
```

**对照 `msp_rtc_config()` 里的分支**，三种时钟源的初始化各不相同：

```c
static void msp_rtc_config(RTC_CLOCK_SOURCE rcs)
{
    // 打开PMU时钟 / 解除备份域写保护 / 备份域重置（三种时钟源都要做）

    if (rcs == HXTAL)
    {
        // 外部高速晶振 8mhz
        rcu_periph_clock_enable(RCU_RTC);
        rcu_rtc_div_config(RCU_RTC_HXTAL_DIV25);            // 8000000 / 25 = 320000
        rcu_rtc_clock_config(RCU_RTCSRC_HXTAL_DIV_RTCDIV);
    }
    else if (rcs == LXTAL)
    {
        // 外部32768hz震荡时钟
        rcu_osci_off(RCU_LXTAL);
        delay_1ms(1);
        rcu_osci_on(RCU_LXTAL);                             // 打开震荡时钟
        if (rcu_osci_stab_wait(RCU_LXTAL) == ERROR)         // 等待稳定
        { printf("turn_on_osci_error\n"); return; }

        rcu_periph_clock_enable(RCU_RTC);
        rcu_rtc_clock_config(RCU_RTCSRC_LXTAL);
    }
    else if (rcs == IRC32K)
    {
        rcu_osci_off(RCU_IRC32K);
        delay_1ms(1);
        rcu_osci_on(RCU_IRC32K);
        if (rcu_osci_stab_wait(RCU_IRC32K) == ERROR)
        { printf("turn_on_osci_error\n"); return; }

        rcu_periph_clock_enable(RCU_RTC);
        rcu_rtc_clock_config(RCU_RTCSRC_IRC32K);
    }

    if (rtc_register_sync_wait() == ERROR) { printf(...); return; }
    printf("rtc_register_sync_wait ok\n");
}
```

| 时钟源 | 要不要手动开振荡器 | 要不要配 `rtc_div` |
| --- | --- | --- |
| HXTAL | **不用**（系统时钟已在用） | **要**（`RCU_RTC_HXTAL_DIV25`） |
| LXTAL | **要** + 等稳定 | 不用 |
| IRC32K | **要** + 等稳定 | 不用 |

**③ 闹钟参数化 + 弱回调**——把写死的时间改成参数，把「中断里干什么」留给应用层：

```c
void msp_rtc_alarm_config(Time *time)
{
    rtc_alarm_struct alarm_struct;
    alarm_struct.alarm_mask = RTC_ALARM_DATE_MASK | RTC_ALARM_HOUR_MASK | RTC_ALARM_MINUTE_MASK;
    alarm_struct.weekday_or_date = RTC_ALARM_DATE_SELECTED;
    alarm_struct.alarm_day = DEC2BCD(time->day);        // ← 改成从参数取
    alarm_struct.alarm_hour = DEC2BCD(time->hour);
    alarm_struct.alarm_minute = DEC2BCD(time->min);
    alarm_struct.alarm_second = DEC2BCD(time->sec);
    alarm_struct.am_pm = RTC_AM;

    rtc_alarm_config(RTC_ALARM0, &alarm_struct);

    // ...（NVIC / EXTI / 中断使能的配置不变）

    rtc_alarm_enable(RTC_ALARM0);
}

#ifndef __weak
#define __weak __attribute__((weak)) // GCC / armclang
#endif
__weak void on_rtc_alarm()
{
    printf("============ alarm ============\n");
}

// 闹钟中断处理函数
void RTC_Alarm_IRQHandler()
{
    if (exti_interrupt_flag_get(EXTI_17) == SET)
    {
        exti_interrupt_flag_clear(EXTI_17);
        rtc_flag_clear(RTC_FLAG_ALRM0);

        on_rtc_alarm();                     // ← 交给应用层
    }
}
```

**`__weak` 回调已经是本工程的固定套路**（和第 03 篇按键的 `on_key_press`、第 04 篇串口的 `on_usart_recv` 一模一样）：**驱动层提供一个默认实现（打印一行），应用层想干什么自己重定义**。

```c
__weak void on_rtc_alarm()
{
    printf("============ alarm ============\n");
}
```

**注意这个默认实现是「有用的默认值」，不是空函数**——空函数的问题是「中断进了但什么都看不到，不知道是没触发还是触发后没做事」。**打印一行反而便于验证**。

### 3.4 `main.c` 里的调用（最终形态）

```c
    //============ 片上外设 ============
    // USART0和USART2初始化
    msp_uart_init();
    // EXTI0 PA0 和 EXTI3 PC3初始化
    msp_exti_init();
    // RTC
    msp_rtc_init(HXTAL);
    ...
    // DMA搬运
    DMA_m2m_config();

    time.year = 2026;
    time.month = 9;
    time.day = 24;
    time.week = 4;
    time.hour = 14;
    time.min = 59;
    time.sec = 55;
    msp_rtc_write(&time);

    time.day = 24;
    time.hour = 15;
    time.min = 0;
    time.sec = 0;
    // 闹钟配置
    msp_rtc_alarm_config(&time);
```

**注意 `time` 是个全局变量**（`User/main.c` 顶部 `Time time;`），所以同一个变量先用来写时间、再用来配闹钟，**是「复用」而不是「两个独立变量」**。这样做省内存，但可读性差一点——后面第九章会把它列为遗留问题。

---

## 四、预分频计算（本节务必自己算一遍）

### 4.1 两级预分频的结构

```
RTCCLK ──→ [异步预分频 FACTOR_A] ──→ CK_APRE ──→ [同步预分频 FACTOR_S] ──→ CK_SPRE = 1 Hz
             7 位（0~0x7F）                        15 位（0~0x7FFF）
                    │                                      │
                    └── 给亚秒寄存器(RTC_SS)提供时钟          └── 给日历提供时钟（每秒 +1）
```

**两个必背公式**：

```
CK_APRE  = RTCCLK / (FACTOR_A + 1)

CK_SPRE  = RTCCLK / ((FACTOR_A + 1) × (FACTOR_S + 1))    ← 目标 = 1 Hz
```

### 4.2 为什么异步固定取 0x7F

异步预分频器**越靠近时钟源、频率越高**，而它只给「亚秒」用；**同步部分越慢越省电**（教材原话：「异步预分频尽可能大」）。所以在合法范围内取最大值：

```
FACTOR_A = 0x7F = 127  →  (FACTOR_A + 1) = 128

于是公式简化成：
    CK_SPRE = RTCCLK / (128 × (FACTOR_S + 1)) = 1 Hz
    ⇒ FACTOR_S = RTCCLK / 128 - 1
```

### 4.3 三种时钟源的完整对照表

| 时钟源 | RTCCLK | 异步 `FACTOR_A` | `RTCCLK/128` | 同步 `FACTOR_S` | 验算 |
| --- | --- | --- | --- | --- | --- |
| **HXTAL** | 8 MHz ÷ 25 = **320 000 Hz** | `0x7F` (127) | 320000/128 = **2500** | **2499**（`0x9C3`） | 320000/128/2500 = 1 ✅ |
| **LXTAL** | **32 768 Hz** | `0x7F` (127) | 32768/128 = **256** | **255**（`0xFF`） | 32768/128/256 = 1 ✅ |
| **IRC32K** | **32 000 Hz** | `0x7F` (127) | 32000/128 = **250** | **249**（`0xF9`） | 32000/128/250 = 1 ✅ |

**三个值都验证通过**，代码里的魔法数就是这几步算出来的。

> **注意 LXTAL 和 IRC32K 的差别**：虽然名字都带 32K，但一个是 **32768**（2 的幂），一个是 **32000**（整数）。
> **这个差别直接体现在同步预分频上：255 vs 249**。如果你把 LXTAL 的 `0xFF` 抄给 IRC32K 用，时钟会**每天慢约 2.3%**（≈ 33 分钟/天）——**这种「看起来在走但越来越偏」的问题最难发现**。

---

## 五、读时间：`msp_rtc_read`

```c
void msp_rtc_read(Time *time)
{
    rtc_parameter_struct rtc_initpara_struct;
    rtc_current_time_get(&rtc_initpara_struct);

    time->year  = 2000 + BCD2DEC(rtc_initpara_struct.year);
    time->month = BCD2DEC(rtc_initpara_struct.month);
    time->day   = BCD2DEC(rtc_initpara_struct.date);      // ← 注意字段名是 date
    time->week  = rtc_initpara_struct.day_of_week;        // ← 唯一不需要转换的字段
    time->hour  = BCD2DEC(rtc_initpara_struct.hour);
    time->min   = BCD2DEC(rtc_initpara_struct.minute);
    time->sec   = BCD2DEC(rtc_initpara_struct.second);
}
```

**三个容易困惑的点**：

| 点 | 说明 |
| --- | --- |
| **`+ 2000`** | RTC 的 `year` 只有两位（0~0x99），**世纪由软件补**。所以要 `2000 + BCD2DEC(...)` |
| **`date` vs `day`** | 库结构体里 `date` 是「几号」，`day_of_week` 是「星期几」。本工程自己的 `Time` 结构体用 `day` 表示「几号」，**两套命名不一致，读代码时要看清是哪个结构体** |
| **`week` 不用转换** | `day_of_week` 是普通数值（1~7），不是 BCD |

**代码里那两行被注释掉的 `printf` 是很有用的调试手段**：

```c
    // printf("sec=%#x, min=%#x, hour=%#x\n", (int)rtc_initpara_struct.second, ...);
```

**用 `%#x` 打印原始 BCD 值**（比如 `sec=0x59`），一眼就能看出「硬件给的是 BCD」这件事；如果直接打十进制你会以为是 89。

---

## 六、写时间：`msp_rtc_write`

```c
void msp_rtc_write(Time *time)
{
    rtc_parameter_struct rtc_initpara_struct;
    // 同步和异步预分频率320000/factor_asyn/factor_syn = 1
    if (rtc_clock_source == HXTAL)      { factor_asyn = 0x7F; factor_syn = 0x9C3; }
    else if (rtc_clock_source == LXTAL) { factor_asyn = 0x7F; factor_syn = 0xFF;  }
    else if (rtc_clock_source == IRC32K){ factor_asyn = 0x7F; factor_syn = 0xF9;  }

    // 设置初始时间
    rtc_initpara_struct.year  = DEC2BCD(time->year % 100);   // ← 只取后两位
    rtc_initpara_struct.month = DEC2BCD(time->month);
    rtc_initpara_struct.date  = DEC2BCD(time->day);
    rtc_initpara_struct.day_of_week = 4;                     // ← ⚠️ 硬编码
    rtc_initpara_struct.hour  = DEC2BCD(time->hour);
    rtc_initpara_struct.minute = DEC2BCD(time->min);
    rtc_initpara_struct.second = DEC2BCD(time->sec);
    rtc_initpara_struct.am_pm = RTC_AM;
    rtc_initpara_struct.display_format = RTC_24HOUR;         // 24 小时制
    rtc_init(&rtc_initpara_struct);                          // ← 一次性写下去
}
```

**逐项解读**：

| 字段 | 说明 |
| --- | --- |
| `time->year % 100` | 2026 → 26 → `DEC2BCD(26)` = `0x26`。**世纪信息在 RTC 里不存在**，靠 `msp_rtc_read` 里那个 `+2000` 补回来 |
| `day_of_week = 4` | **⚠️ 硬编码成 4（星期四）**，`Time.week` 传进来被忽略了。详见第九章遗留问题 |
| `am_pm = RTC_AM` + `display_format = RTC_24HOUR` | 24 小时制下 `am_pm` 无意义，但仍要填 |
| **`rtc_init()` 一次性写入** | 预分频、时间、格式**必须在同一次调用里配齐**。RTC 的 `rtc_init` 会走一套「进入初始化模式 → 写全部寄存器 → 退出初始化模式」的流程，**分两次调会把前一次的内容覆盖掉** |

**这也解释了 `msp_rtc_init()` 里那句看起来多余的调用**：

```c
void msp_rtc_init(RTC_CLOCK_SOURCE rcs)
{
    rtc_clock_source = rcs;
    msp_rtc_config(rcs);          // 配时钟源
    Time time = {0};
    msp_rtc_write(&time);         // 立刻写一个全 0 的时间
}
```

**为什么初始化里就写一次时间？** 因为 `rtc_init()` 会**一并把预分频器写进去**——**预分频不写，RTC 就不会以 1 Hz 走**。所以这里先用全 0 占位，让时钟链先跑起来；`main()` 里随后再用真实时间写一遍。

> ⚠️ **但 `Time time = {0}` 意味着写入 `2000-00-00 00:00:00`**（月/日为 0，都是非法值），`day_of_week` 又是硬编码 4。**这是一个可以自己动手修的点**：初始化时应该给一个合法默认值（比如 `2000-01-01`），或者在写完真实时间后才允许读取。

---

## 七、闹钟：`msp_rtc_alarm_config`

### 7.1 结构体字段

```c
rtc_alarm_struct alarm_struct;
alarm_struct.alarm_mask = RTC_ALARM_DATE_MASK | RTC_ALARM_HOUR_MASK | RTC_ALARM_MINUTE_MASK;
alarm_struct.weekday_or_date = RTC_ALARM_DATE_SELECTED;   // 用「几号」而不是「星期几」
alarm_struct.alarm_day    = DEC2BCD(time->day);
alarm_struct.alarm_hour   = DEC2BCD(time->hour);
alarm_struct.alarm_minute = DEC2BCD(time->min);
alarm_struct.alarm_second = DEC2BCD(time->sec);
alarm_struct.am_pm = RTC_AM;

rtc_alarm_config(RTC_ALARM0, &alarm_struct);
```

| 字段 | 说明 |
| --- | --- |
| `alarm_mask` | **指定「哪些字段不参与比较」**，见 7.2 |
| `weekday_or_date` | `RTC_ALARM_DATE_SELECTED` = 用日期匹配；另一个可选值是用星期匹配 |
| `alarm_day` / `hour` / `minute` / `second` | 比较值，**必须是 BCD** |
| `am_pm` | 12 小时制时才需要 |

### 7.2 ⚠️ `alarm_mask` 是「忽略」，不是「启用」

**这是本篇最容易搞反的地方**。看教材的注释原文：

```c
// 设置忽略的选项 (让闹钟在每分钟的xx秒都执行)
rat.alarm_mask = RTC_ALARM_DATE_MASK | RTC_ALARM_HOUR_MASK | RTC_ALARM_MINUTE_MASK;
// 设置忽略的选项 (让闹钟在每小时的xx分钟xx秒都执行)
// rat.alarm_mask = RTC_ALARM_DATE_MASK | RTC_ALARM_HOUR_MASK;
// 设置忽略的选项 (让闹钟在每天的xx小时xx分钟xx秒都执行)
// rat.alarm_mask = RTC_ALARM_DATE_MASK;
```

**三种 mask 的含义对照**：

| `alarm_mask` | 被忽略的字段 | 实际触发时机 |
| --- | --- | --- |
| `DATE \| HOUR \| MINUTE`（**本工程用的**） | 日期、小时、分钟都忽略，**只比秒** | **每小时的每一分钟，在 xx 秒都触发** → 即**每分钟触发一次** |
| `DATE \| HOUR` | 只比分钟和秒 | **每小时**的 xx 分 xx 秒触发 |
| `DATE` | 只比「时:分:秒」 | **每天**的 xx:xx:xx 触发（叫「每日闹钟」） |

**所以本工程的闹钟实际行为是**：

```c
    time.day = 24;
    time.hour = 15;
    time.min = 0;
    time.sec = 0;
    msp_rtc_alarm_config(&time);
```

**直觉上像「15:00:00 闹一次」，但由于 `DATE|HOUR|MINUTE` 都被 mask 掉了，真正的效果是「每分钟的第 0 秒都闹一次」**。`day=24 / hour=15 / min=0` 这几个值**根本没参与比较**。

> **改成「每天 15:00:00 响一次」的办法**：把 `alarm_mask` 改成只留 `RTC_ALARM_DATE_MASK`。**记住一句话：mask 位是「把这一项划掉」的意思。**

### 7.3 中断链路

```
RTC 计数值 == 闹钟值
      ↓ 置位 RTC_FLAG_ALRM0
   RTC 中断使能（RTC_INT_ALARM0）→ 通过 EXTI_17 输出请求
      ↓
   EXTI_17（必须 exti_init + exti_interrupt_enable）
      ↓
   NVIC（RTC_Alarm_IRQn，优先级 2/2）
      ↓
   RTC_Alarm_IRQHandler()
      ├─ exti_interrupt_flag_clear(EXTI_17)     ← 清 EXTI 侧
      ├─ rtc_flag_clear(RTC_FLAG_ALRM0)         ← 清 RTC 侧
      └─ on_rtc_alarm()                          ← 应用层回调
```

**两个标志都要清**，这是 RTC 闹钟特有的坑（普通外设只有一个标志位）。

---

## 八、参数速查表

```c
// --- Hardware/msp_rtc.h ---
#define DEC2BCD(val) ((((val) / 10) << 4) | ((val) % 10))
#define BCD2DEC(val) (((val) >> 4) * 10 + ((val) & 0x0F))

typedef struct { uint16_t year; uint8_t month, day, week, hour, min, sec; } Time;
typedef enum { HXTAL = 0, LXTAL, IRC32K } RTC_CLOCK_SOURCE;

void msp_rtc_init(RTC_CLOCK_SOURCE rcs);      // 配时钟源 + 先写一个占位时间
void msp_rtc_read(Time *time);                // 读日历（BCD→十进制）
void msp_rtc_write(Time *time);               // 写日历（十进制→BCD
void msp_rtc_alarm_config(Time *time);        // 配闹钟 + 中断链路
extern void on_rtc_alarm();                   // 弱回调，应用层重定义
```

| 项目 | 值 |
| --- | --- |
| 当前时钟源 | **`HXTAL`**（8 MHz ÷25 = 320 kHz） |
| 备用时钟源 | `LXTAL`（32.768 kHz，精度最高，需焊晶振）/ `IRC32K`（内部，精度最低） |
| 异步预分频 | `0x7F`（三种时钟源统一） |
| 同步预分频 | HXTAL `0x9C3` / LXTAL `0xFF` / IRC32K `0xF9` |
| 时间格式 | **24 小时制**，BCD 编码 |
| 备份域 | 需 `pmu_backup_write_enable()` 解除写保护；每次初始化都 `rcu_bkp_reset` |
| 闹钟 | `RTC_ALARM0`，`weekday_or_date = RTC_ALARM_DATE_SELECTED` |
| 闹钟实际行为 | **每分钟触发一次**（`DATE \| HOUR \| MINUTE` 三段被 mask） |
| 闹钟中断线 | **`EXTI_17`**（硬件固定）→ `RTC_Alarm_IRQn`，优先级 2/2 |
| 中断函数名 | **`RTC_Alarm_IRQHandler`** |
| 回调 | `on_rtc_alarm()`（`__weak`） |

---

## 九、遗留问题（可以动手改的地方）

| # | 问题 | 现象 / 风险 | 改法 |
| --- | --- | --- | --- |
| 1 | **`day_of_week` 硬编码为 4** | `Time.week` 传进来没用，`main.c` 里 `time.week = 4` 是摆设 | 改成 `DEC2BCD(time->week)`，或者在写入前根据日期算出星期 |
| 2 | **`msp_rtc_init` 写入全 0 时间** | 月/日为 0 是非法值；初始化后到 `msp_rtc_write` 之间读时间会得到脏数据 | 用合法默认值（`2000-01-01`）；或初始化只配预分频不写日历 |
| 3 | **每次都重置备份域** | `rcu_bkp_reset_enable()` 会**清掉 20 个 BKP 寄存器**，导致「只配置一次时间」的方案无法实现 | 用 BKP 寄存器存一个「已配置」标志，有标志就跳过重置与重新写时间 |
| 4 | **闹钟行为与代码意图不符** | 想「15:00:00 响一次」，实际「每分钟响一次」 | 明确 `alarm_mask` 语义：只留 `RTC_ALARM_DATE_MASK` 就是每日闹钟 |
| 5 | **`time` 是全局变量、被复用** | 先写时间再配闹钟，同一个变量装两种语义 | 定义两个局部 `Time`（写时间用 `write_time`、闹钟用 `alarm_time`） |
| 6 | **用 HXTAL 意味着掉电就停** | 无法实现真正的「断电走表」 | 焊 32.768 kHz 晶振 + 12 pF 电容，改用 `LXTAL`，并装 VBAT 电池 |
| 7 | **没有用「亚秒」和「唤醒定时器」** | 只能做到秒级精度 | RTC 还有 `RTC_SS`（亚秒）和 WakeUp Timer，可做毫秒级周期唤醒 |
| 8 | **错误处理只是 `printf` + `return`** | 初始化失败后代码继续跑，用的是一个不可用的 RTC | 加返回值让调用方判断，或进入安全状态 |

---

## 十、排查清单

| 现象 | 优先检查 |
| --- | --- |
| **时间不走字（秒不变）** | 忘了 `rcu_bkp_reset_enable()`（教材点名的原因）；`rcu_rtc_div_config` 没配；`rtc_init` 里预分频没写 |
| 走字但速度不对（快/慢成倍） | 预分频值和时钟源对不上——**HXTAL/LXTAL/IRC32K 三套值不能混用** |
| 每天都偏一点，越走越偏 | 用 IRC32K（内部 RC 精度差）；或 LXTAL 的匹配电容不对（应用负载电容 < 7 pF 的晶振） |
| 时间能读但设不进去 | 没调 `pmu_backup_write_enable()`；或没重置备份域 |
| 复位后时间被重置了 | 初始化里无条件写了时间——应该先读 BKP 判断是否已配置 |
| 闹钟完全不触发 | 五件套缺一：`rtc_interrupt_enable` / `exti_init(EXTI_17)` / `exti_interrupt_enable` / `nvic_irq_enable` / `rtc_alarm_enable` |
| 闹钟进了但反复进 | 只清了一个标志位（EXTI 和 RTC **两个都要清**） |
| 闹钟触发比预期频繁 | `alarm_mask` 掩掉了日/时/分——变成每分钟触发 |
| 闹钟偶发不触发或频繁触发（教材专门提的） | **编译器优化等级**问题：把 Optimization 调成 `-O2` / `-O3` / `-Ofast` 再试（教材原话） |
| 读了时间发现年是 2000 多 | 正常——`year` 只有两位，`+2000` 是软件补的世纪 |
| BCD 值显示成 89 之类的怪数字 | 用 `%d` 打了 BCD 原始值，应该用 `%#x` 或先 `BCD2DEC` |
| 改了 `Time` 结构体后读出来乱 | 忘了 `DEC2BCD` / `BCD2DEC`，两边格式不一致 |

## 十一、自测题

1. 为什么说「RTC 本质是一个 1 秒计数器」？它和普通定时器（TIMER）的三条区别是什么？
2. RTC 的三个时钟源分别是什么？各自需要什么硬件条件？本工程为什么选 HXTAL？
3. 为什么异步预分频取 `0x7F`（最大）？写出 `CK_SPRE` 的计算公式。
4. LXTAL 的同步预分频是 `0xFF`、IRC32K 是 `0xF9`——**为什么差 6**？如果混用会发生什么？
5. BCD 码怎么表示 26？为什么 RTC 用 BCD 而不用普通二进制？写出 `DEC2BCD` / `BCD2DEC` 的展开过程。
6. 为什么读时间要 `2000 + BCD2DEC(year)`？世纪信息存在哪？
7. 为什么改 RTC 配置前要 `pmu_backup_write_enable()`？`rcu_bkp_reset_enable()` 有什么副作用？
8. RTC 闹钟为什么要经过 EXTI_17？完整的中断链路是哪几级？
9. `alarm_mask = RTC_ALARM_DATE_MASK | RTC_ALARM_HOUR_MASK | RTC_ALARM_MINUTE_MASK` 时，闹钟多久响一次？想改成「每天 15:00 响一次」该怎么改？
10. 为什么 RTC 闹钟的中断处理函数要清**两个**标志位？分别是什么？
11. `msp_rtc_init()` 里为什么要写一个 `Time time = {0}`？不写会有什么后果？
12. 为什么 `msp_rtc_write()` 里的预分频、时间、格式必须在**一次** `rtc_init()` 调用里写齐？

## 十二、练习题

1. 把 `day_of_week` 改成从 `Time.week` 传参，并写一个「根据年月日算星期几」的小函数来填它。
2. 实现「只配置一次时间」：用备份寄存器 `RTC_BKP0` 存一个魔数，上电时先读它，等于魔数就跳过备份域重置和时间写入。
3. 把闹钟改成「每天 15:00:00 响一次」（提示：改 `alarm_mask`），并实测验证触发间隔。
4. 用第 09 篇的数码管（或串口打印）做一个「RTC 时钟显示」：每秒读一次时间并显示。
5. 改用 `LXTAL` 作为时钟源，并计算需要更换的同步预分频值；如果板上没焊晶振，观察 `rcu_osci_stab_wait(RCU_LXTAL)` 是否返回 `ERROR`。
6. 用第 07 篇的蜂鸣器给闹钟加一个「到点响一声」，通过重定义 `on_rtc_alarm()` 实现（体会弱回调的用法）。
7. 算一算：如果把 IRC32K 的 `factor_syn = 0xF9` 误写成 LXTAL 的 `0xFF`，一天会偏多少秒？

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `7ff9b34` | 2026-09-24 15:44 | [更新] 内部 RTC，使用外部高速晶振为时钟源 | `main.c` +127 行：`DEC2BCD`/`BCD2DEC` 宏、`Time` 结构体与全局 `time`、本地 `msp_rtc_config()`（HXTAL + `RCU_RTC_HXTAL_DIV25`）、`msp_rtc_read()`、`msp_rtc_write()`；主循环用 `cnt == 50` 每秒打印时间；`.eide/eide.yml` 加入 `gd32f4xx_rtc.c`（含 `gd32f4xx_pmu.c`） |
| `e37d8db` | 2026-09-24 17:25 | [更新] 内部 RTC，闹钟中断 | 新增 `msp_rtc_alarm_config()`（写死 0x24/0x15/0x00/0x00）+ `RTC_Alarm_IRQHandler()`；配齐 RTC 中断 + **`EXTI_17`** + NVIC 三级链路；清掉上一版遗留的注释初始化模板块 |
| `7107a78` | 2026-09-26 09:48 | [更新] **内部 RTC 封装** | 新建 `Hardware/msp_rtc/msp_rtc.c/h`：`RTC_CLOCK_SOURCE` 枚举（HXTAL/LXTAL/IRC32K）+ 三种时钟源的初始化分支；`static rtc_clock_source` 驱动预分频选择；`Time` 结构体与 BCD 宏移到头文件；闹钟参数化（`Time *time`）；新增 `__weak on_rtc_alarm()` 回调；`main.c` 净减 128 行 |

**这三次提交走过的三级台阶**

| 台阶 | 提交 | 解决了什么 |
| --- | --- | --- |
| 1. 跑起来 | `7ff9b34` | 时钟源、预分频、BCD 换算、读写时间 |
| 2. 能响应 | `e37d8db` | 闹钟 + EXTI_17 + NVIC 中断链路 |
| 3. 好维护 | `7107a78` | 移到 `Hardware/`、时钟源参数化、回调解耦 |

**顺带被改动的地方**

| 提交 | 顺带改动 |
| --- | --- |
| `7ff9b34` | `.eide/eide.yml` 增加 `gd32f4xx_rtc.c` 编译项 |
| `6827512` `bbce6b7` | 看门狗两次提交都在 RTC 之后，`main.c` 的初始化顺序变成「UART → EXTI → RTC → 看门狗」（见第 12 篇） |

## 参考笔记

- `../../../NOTE/Textbook/RTC/RTC内置实时时钟🌟.mhtml` —— RTC 原理（结构框图、原理图、电源域、配置流程、BCD 转化、备份寄存器）
  - 要点的「中文版」讲法：结构框图里那条 `RTCCLK → CK_APRE → CK_SPRE` 链路就是本篇第四章
  - 教材明确点出「**不重置备份域可能导致无法设置晶振，出现不走字情况**」——这是排查 RTC 的第一条
- `../../../NOTE/Textbook/RTC/RTC闹钟Alarm.mhtml` —— 闹钟（dev flow、mask 的三种用法、中断函数、闹钟 Bug 处理）
  - 「mask 三种用法」的三条注释 = 本篇 7.2 节的对照表
  - 「闹钟 Bug 处理（调优化等级 -O2/-O3/-Ofast）」是很实用的经验，见第十章排查清单
- `../../../NOTE/Note/TIMER.md` —— 定时器与 PWM（对照理解「定时器」与「RTC」的区别）

- `../../../NOTE/Note/RTC.md` —— RTC 实时时钟（**2026-10-06 新增的整理版**）：RTC 原理、备份域、预分频、闹钟，本篇第三章「预分频计算」与第七章「闹钟」可与其对照
- `../../../NOTE/Note/WDGT.md` —— 看门狗（同为新增，第 12 篇）
> 本笔记仅作学习整理，内容来自本仓库真实提交记录。
