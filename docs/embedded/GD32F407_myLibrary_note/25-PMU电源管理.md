# 25 · PMU 电源管理单元 · 学习笔记

> 这一篇有点特别：**PMU 没有对应的 git 提交** —— 它是 2026-10-07 教材新增的一章（`Textbook/PMU/电源管理单元.mhtml`）带来的模块，代码里的省电模式**还没写**。
> 但 PMU 其实**已经在工程里"隐形工作"了三处**：168 MHz 时钟配置里的 LDO/high-drive、RTC 备份域的写保护解锁、备份域本身。
> 所以本篇 = 「教材知识（三个电源域 + 三种省电模式）」+「工程里 PMU 的三处真实足迹」+「真要加省电模式时该动哪里、会和谁打架」。
> 整理日期：2026-10-07　｜　提交范围：**无独立提交**（教材新增 + 现有代码中的 PMU 足迹）

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想知道"为什么上 168 MHz 要动 PMU" | 直接看 §2.1（**这是本篇唯一和现有代码强相关的一节**） |
| 想知道省电模式怎么选 | §3 对照表 + §6 唤醒源表 |
| 想动手加一个低功耗模式 | §5（三段现成写法）+ §7（**先看冲突清单，否则一睡不醒**） |
| 想搞懂 VBAT / 备份域 | §2.3 + 第 11 篇（RTC）、第 17 篇（PCF8563 备电） |

## 知识点地图

```
PMU（本篇）
├── 一、PMU 是什么              LDO / LVD / POR-PDR / BPOR / BLDO 五个缩写先认清
├── 二、★ 工程里的三处 PMU 足迹  ① 168MHz 的 LDOVS + HDEN/HDS  ② RTC 备份域写保护  ③ 备份域本身
├── 三、三个电源域              VDD/VDDA 域、1.2V 域、备份域 —— 各供了谁
├── 四、三种省电模式            睡眠 / 深度睡眠 / 待机（对照表）
├── 五、WFI 与 WFE              两条指令的差别
├── 六、实操：真要写省电模式     三段模板 + 本板唤醒源（PA0=WKUP、EXTI、RTC 闹钟、FWDGT）
├── 七、★ 和现有模块的冲突        SysTick / 串口 / 看门狗 / OLED / Flash / DMA / NVIC 分组
├── 八、排查清单
└── 九、自测题 + 练习题
```

## 学习目标

1. 认出 PMU 相关的五个缩写（LDO / LVD / POR / PDR / BPOR / BLDO），说清各自"防的是什么"。
2. 解释**为什么 168 MHz 必须先 `PMU_CTL |= PMU_CTL_LDOVS`，再 `HDEN` + `HDS`**——并且能在代码里指出这三步。
3. 说清三个电源域各供给谁，为什么 RTC 和 LSE 在"掉主电"时还能活着。
4. 能照葫芦画瓢写出三种省电模式，并说清各自的**进入条件、唤醒源、唤醒后要做什么**。
5. 知道本板能用什么唤醒（`PA0=WKUP`、EXTI、RTC 闹钟、FWDGT 复位）以及**哪些模块会在睡眠时"停摆"**。

---

## 一、PMU 是什么：先认清五个缩写

教材原话：**PMU = Power Management Unit，电源管理单元**。它不是一个"外设"，而是**管电的那一套硬件**的总称，主控是 `PMU_CTL` / `PMU_CS` 两个寄存器。

| 缩写 | 全称 | 干什么 | 什么时候会想起它 |
| --- | --- | --- | --- |
| **LDO** | Low Drop-Out regulator | 电压调节器：把 3.3 V 降压成内核用的 1.2 V | **超频到 168 MHz 时必须切到低压档**（§2.1）、低功耗时切低功耗档 |
| **LVD** | Low Voltage Detector | 低压检测器：电压掉到阈值以下就报警/中断 | 电池供电场景；本工程未用 |
| **POR / PDR** | Power-On Reset / Power-Down Reset | 上电复位 / 掉电复位 | 板子上电"自动重启"、电压抖动导致反复重启时 |
| **BPOR** | Backup domain POR | **备份域**的上电复位 | 备份域（RTC/BKP）为什么不受主电复位影响 |
| **BLDO** | Backup LDO | 备份域的 LDO，输出 1.2 V，给备份 SRAM 供电 | 备份 SRAM（BKP RAM）掉电保数据 |

> **一句话理解**：LDO 负责"把电压调成当前频率/功耗档位需要的那个值"，LVD/POR/PDR/BPOR 负责"电压不对就复位/报警"。
> **PMU 的作用就是把这两件事做成可编程的**——所以"改频率"和"省电"都必须先经过它。

---

## 二、★ 工程里的三处 PMU 足迹

### 2.1 `system_gd32f4xx.c`：上 168 MHz 的三步 PMU 操作

工程实际用的时钟配置函数是 `system_clock_168m_8m_hxtal()`（第 51 行 `#define __SYSTEM_CLOCK_168M_PLL_8M_HXTAL` 选中它）。
它里面**有三处必须在"切时钟"之前完成、而且是 PMU 寄存器操作**的代码：

```c
/* 第 601~602 行：先给 PMU 开时钟，再把 LDO 切到低压档 */
RCU_APB1EN |= RCU_APB1EN_PMUEN;    // PMU 挂在 APB1 上，先使能时钟
PMU_CTL    |= PMU_CTL_LDOVS;       // LDO 电压选择（Low Voltage Select）

... 配 PLL（PSC=8 → VCO 336 MHz → ÷2 = 168 MHz）并等它稳定 ...

/* 第 622~630 行：打开 high-drive 并切过去（库注释原文：to extend the clock frequency to 168 Mhz） */
PMU_CTL |= PMU_CTL_HDEN;           // ① 使能高驱动能力
while(0U == (PMU_CS & PMU_CS_HDRF)){ }   //    等"高驱动就绪"标志 HDRF
PMU_CTL |= PMU_CTL_HDS;            // ② 切换到高驱动模式
while(0U == (PMU_CS & PMU_CS_HDSRF)){ }  //    等"切换完成"标志 HDSRF

/* 第 632~638 行：最后才把系统时钟切到 PLL */
RCU_CFG0 &= ~RCU_CFG0_SCS;
RCU_CFG0 |= RCU_CKSYSSRC_PLLP;
while(0U == (RCU_CFG0 & RCU_SCSS_PLLP)){ }
```

**为什么顺序不能颠倒**（这是本节的核心）：

| 步骤 | 不做的后果 |
| --- | --- |
| `PMU_CTL_LDOVS` | 1.2 V 内核电压偏高/偏低，跑不动 168 MHz，或功耗白烧 |
| `PMU_CTL_HDEN` + `HDS` | 驱动能力不足，**高频下内核供电跟不上**（库注释原话就是"为了把频率提到 168 MHz"） |
| 两个 `while` 等标志 | 不等 `HDRF`/`HDSRF` 就往下走，等于没切成功 |
| **PMU 时钟（`RCU_APB1EN_PMUEN`）** | **不使能 PMU 时钟，后面所有 `PMU_CTL` 写操作全是空操作** ← 最隐蔽的一脚 |

> 💡 **和教材的差异**：教材那三行 `sleep_mode()` 里都写了 `rcu_periph_clock_enable(RCU_PMU);`——
> 同一个道理：**PMU 是 APB1 上的外设，用之前先开时钟**。忘了这一句，程序"能编译、能跑、但没效果"，
> 而且**不会报错**（这也是第 14 篇"改时钟树的影响面"里提到的同一类坑）。
>
> 顺带：同一文件里 `system_clock_120m_irc16m()` 的库注释写的是 *"Enable the high-drive to extend the clock frequency to 120 Mhz"*，
> 168 MHz 版本则写 *"to 168 Mhz"*——**换频率就要重算/重选 LDO 与驱动档位，不是"写一次就通用"**。

### 2.2 `Hardware/msp_rtc/msp_rtc.c`：备份域的"解锁钥匙"在 PMU 手里

第 11 篇讲过"RTC 在备份域、要解锁写保护才能改"。**解锁的那把钥匙，就是 PMU 寄存器**：

```c
// 打开 PMU 时钟
rcu_periph_clock_enable(RCU_PMU);
// 通过 PMU 解除备份域写保护        ← 注释写得很清楚
// pmu_deinit();
pmu_backup_write_enable();
// 备份域重置（会清掉 BKP 寄存器，第 11 篇提过这是个小隐患）
rcu_bkp_reset_enable();
rcu_bkp_reset_disable();
```

| 库函数 | 对应寄存器位 | 作用 |
| --- | --- | --- |
| `pmu_backup_write_enable()` | `PMU_CTL_BKWEN` | **解除备份域写保护**（RTC 寄存器、BKP 寄存器才能写） |
| `pmu_backup_write_disable()` | 清 `BKWEN` | 写完再上锁 |

**顺序就是固定套路**：`开 PMU 时钟 → pmu_backup_write_enable() → 改 RTC/BKP → （可选）上锁`。
如果发现"RTC 写不进去、时间停在 00:00:00"，先回到这一行看写使能有没有成功。

### 2.3 备份域：为什么 RTC / LSE 能"掉主电不死"

硬件文档里有一条容易忽略的事实：

| 事实 | 出处 |
| --- | --- |
| 板上 **PCF8563** 有独立备电（电池座） | `Doc/硬件信息汇总.md` 4.13 节 |
| **MCU 侧没有 32.768 kHz 晶振**（LXTAL 空焊），所以第 11 篇的 RTC 只能用 HXTAL 分频 | `Doc/硬件信息汇总.md` / 第 11 篇 |
| 备份域由 **VBAT 引脚**（本板接 `BAT` 网络）供电，主电掉时自动切换 | `Doc/硬件信息汇总.md` 网络表 `BAT :: P4.26, U9.66` |
| 备份域供：**LXTAL、RTC、BPOR、电源转换**（= 教材 §备份域） | `Textbook/PMU` |

**结论**：备份域是一块"**独立供电的小岛**"——主电没了，它靠 VBAT 继续给 RTC 计时；
这也是为什么 `rcu_bkp_reset` 是**唯一能清掉 RTC 配置的操作**（普通复位不行）。

> 本工程两个"带时间的器件"正好对应两种备电方案：
> **内部 RTC**（备份域 + VBAT，但用 HXTAL 分频）与 **外部 PCF8563**（I2C + 自己的电池座）——见第 17 篇结尾的对照表。

---

## 三、三个电源域（教材骨架 + 本工程对照）

教材原话：**总共有三大电源域，包括 VDD/VDDA 域、1.2V 域和备份域。**

| 电源域 | 供了谁 | 谁关它 | 本工程对应 |
| --- | --- | --- | --- |
| **VDD / VDDA 域** | 看门狗（FWDGT）、晶振（HXTAL/IRC16M/IRC32K）、ADC/DAC、LDO 电源转换、上电复位、PLL | 待机模式会关掉 LDO/IRC16M/HXTAL/PLL | `VDDA` 给 ADC（第 19 篇的温度/多通道采集）；`RCU` 上的振荡器都在这儿 |
| **1.2V 域** | AHB 总线、APB 外设总线、内存（BSRAM）、Cortex-M4 内核 | 睡眠关内核、深度睡眠**全关**、待机全关 | 全部外设的"饭碗" |
| **备份域** | **LXTAL、RTC、BPOR、电源转换** | **几乎不关**（只能被 `rcu_bkp_reset` 清、或 VBAT 断电） | `msp_rtc`（第 11 篇）+ PCF8563 备电（第 17 篇） |

**三个域的意义**：**省电模式 = "依次往下关哪一个域"**。这也是下一节那张表的本质。

---

## 四、三种省电模式的对照（教材表格整理）

| | **睡眠 Sleep** | **深度睡眠 Deep-sleep** | **待机 Standby** |
| --- | --- | --- | --- |
| 关了 1.2V 域的谁 | **只关 CPU 时钟** | **全关** | **全关** |
| 关了 VDD/VDDA 域的谁 | 不关 | **IRC16M、HXTAL、PLL** | **LDO、IRC16M、HXTAL、PLL**（全关） |
| LDO 状态 | 正常（可选低功耗档） | 正常 / 低功耗（可选） | **关闭** |
| `SLEEPDEEP` | 0 | 1 | 1 |
| 额外配置位 | — | `STBMOD = 0` | `STBMOD = 1`、`WURST = 1` |
| 进入指令 | `WFI` / `WFE` | `WFI` / `WFE` | 只能"进入"，没有 `WFI/WFE` 的说法（`pmu_to_standbymode()`） |
| 唤醒源 | `WFI`：**任意中断**；`WFE`：任意事件 | 同左 | **NRST 引脚、WKUP 引脚、FWDGT 复位、RTC 闹钟/入侵** |
| 唤醒后 | 接着往下跑 | 接着跑，但**时钟需要重新配**（代码里调 `SystemInit()`） | **相当于复位**，从头跑（`main` 开始） |
| 功耗 | 降得最少 | 中 | 最低 |
| 一句话 | 「**停 CPU，外围照跑**」 | 「**停 CPU + 停高频时钟**」 | 「**除了备份域，全停**」 |

**耗时/可用的直觉**：

- **睡眠**最轻——串口、定时器（含 SysTick）、DMA 全部照常，**中断一到立刻醒**。适合"等一个事件"。
- **深度睡眠**把 16 M/8 M/PLL 都关了，唤醒要走"**上电序列**"（LDO 起振、IRC16M 稳定……），所以教材特地写了「**唤醒延迟**：如果 LDO 处于低功耗模式，需增加 LDO 唤醒时间」。
- **待机**最省，但**醒来等于复位**——所有变量（除备份域）全丢，程序从 `main` 重新开始。所以代码里必须先 `pmu_flag_clear(PMU_FLAG_RESET_STANDBY)` 判断"我是冷启动还是从待机醒来"。

> **和看门狗的关系（重要）**：待机模式下 **FWDGT 不会被关**（它属于 VDD 域），
> 所以"想睡很久"必须先**关掉/喂饱**独立看门狗，否则你会被自己的狗叫醒（第 12 篇）。

---

## 五、WFI 与 WFE

教材原话：

- **WFI（Wait For Interrupt）**：进入低功耗，直到有**中断请求**到来才唤醒；
- **WFE（Wait For Event）**：除了中断，还能被**事件**唤醒（外部设备或其他处理器触发的信号）。

差别用一句话记住：

> **WFE 多了一条"事件"这个开关**（`SEVONPEND`、`SEV` 指令、外部事件线都能触发），
> 所以它适合"我在等某个动作，但不一定要进中断服务函数"的场景；
> **WFI 更常用**，因为它和"中断驱动的程序结构"天然一致——**本工程（以及教材示例）全部用 `WFI`**。

库里的写法是传参给宏：

```c
#define WFI_CMD  ((uint8_t)0x00U)   // 用 WFI 进入
#define WFE_CMD  ((uint8_t)0x01U)   // 用 WFE 进入

pmu_to_sleepmode(WFI_CMD);                          // 睡眠
pmu_to_deepsleepmode(PMU_LDO_LOWPOWER, PMU_LOWDRIVER_ENABLE, WFI_CMD);  // 深度睡眠
pmu_to_standbymode();                               // 待机
```

---

## 六、实操：真要写省电模式该写什么

以下是教材三个模板 + 本工程需要的补充（**本工程目前一行都没写**）：

### 6.1 睡眠模式

```c
void sleep_mode(void)
{
    rcu_periph_clock_enable(RCU_PMU);   // ★ 别忘了这句
    printf("enter sleep\n");            // ★ 唤醒后才打印出来（见 §7.2）
    pmu_to_sleepmode(WFI_CMD);
    printf("wake up\n");
}
```

### 6.2 深度睡眠模式（**注意唤醒后要重配时钟**）

```c
void deepsleep_mode(void)
{
    rcu_periph_clock_enable(RCU_PMU);
    pmu_to_deepsleepmode(PMU_LDO_LOWPOWER, PMU_LOWDRIVER_ENABLE, WFI_CMD);
    SystemInit();                       // ★★ 把 168 MHz 重新配回来（LDO/HD 档位也要重来）
}
```

> **这一句 `SystemInit()` 是深度睡眠最容易忘、也最致命的一句**：
> 睡眠时 PLL/HXTAL 被关了，醒来如果不重配，`SystemCoreClock` 还是 168000000，
> **但实际频率已经掉回 IRC16M 的 16 MHz** —— 于是串口波特率、定时器周期、SysTick 延时**全部慢 10.5 倍**。
> （第 14 篇讲过 `SystemInit()` 做的全部事情，这里正好复用它。）

### 6.3 待机模式

```c
void standby_mode(void)
{
    rcu_periph_clock_enable(RCU_PMU);
    pmu_flag_clear(PMU_FLAG_RESET_STANDBY);   // 清"待机复位"标志
    pmu_wakeup_pin_enable();                  // 使能 WKUP 引脚唤醒
    pmu_to_standbymode();                     // 这一行之后程序就"断"了，醒来是从 main 重新跑
}
```

> 唤醒后用 `pmu_flag_get(PMU_FLAG_STANDBY)`（或判断复位来源）来区分"冷启动"还是"从待机醒来"。
> 相关标志位（库定义）：`PMU_FLAG_WAKEUP`、`PMU_FLAG_STANDBY`、`PMU_FLAG_LVD`、`PMU_FLAG_BLDORF`、`PMU_FLAG_HDRF`、`PMU_FLAG_HDSRF`、`PMU_FLAG_LDRF`。

### 6.4 本板能用什么唤醒

| 唤醒源 | 本板对应 | 备注 |
| --- | --- | --- |
| **WKUP 引脚（PA0）** | `PA0` → `P3.3` 排针 | ⚠️ **板上 PA0 悬空、无上下拉**（硬件文档 P3 问题！）→ 想用它唤醒必须**先加上拉**，否则浮空误唤醒（第 06 篇同一个坑） |
| EXTI 中断线 | `PC3`（KEY4）/ 其它 EXTI | 睡眠/深度睡眠靠它唤醒；**注意 NVIC 优先级设置**（见 §7.4） |
| **RTC 闹钟** | 内部 RTC（`EXTI_17`，第 11 篇） | **待机模式下唯一还能"定时叫醒你"的东西**（配合备份域） |
| **FWDGT 复位** | 独立看门狗 | 是"叫醒"，但醒来是复位——不是唤醒，是罚站 |
| 外部 I2C 器件 | PCF8563 的 `INT` 引脚 | 需接回 MCU 的 EXTI；本工程暂未这样接 |

---

## 七、★ 和现有模块的冲突清单（这一节比模式本身更重要）

把本工程现有的 12 个模块和"睡眠"放一起看，会撞上这些：

| # | 消失/异常的东西 | 原因 | 处理 |
| --- | --- | --- | --- |
| 1 | **`delay_1ms()` 不准/卡住** | SysTick 的计数源就是**内核时钟**；睡眠时内核时钟被门控 → **SysTick 停止计数**（建议用打印实测确认这一点） | 睡眠前后不要依赖"睡够多少毫秒"；要定时就用 **RTC 闹钟**（备份域不受影响） |
| 2 | **串口打印"丢失"前半句** | 睡眠期间 USART 时钟停了/数据没搬完 | 进入前 `printf("enter sleep\n")` 之后**要等发送完成**再睡（或用"唤醒后再打印"的写法） |
| 3 | **被看门狗复位** | FWDGT 在 VDD 域，**待机模式也不关** | 睡前配置/喂狗，或干脆用 RTC 唤醒 + 关闭看门狗 |
| 4 | **深度睡眠"睡死"唤醒不了** | NVIC 分组是 `NVIC_PRIGROUP_PRE2_SUB2`：教材明确指出 —— ①**串口抢占优先级不能设为 0**，②**深度睡眠的外部中断抢占优先级要设为 0 或 1（比串口高）**，否则无法唤醒 | 调 `nvic_irq_enable(EXTIx_IRQn, 抢占, 响应)` 的两个优先级参数（第 06 篇 §EXTI 五步） |
| 5 | **OLED/数码管不再刷新** | 扫描/刷新靠定时器中断或主循环 | 只在"要显示"时醒来一会儿（间歇工作） |
| 6 | **Flash 写操作超时/复位** | 擦一个扇区约 45 ms（第 24 篇 §7.2） | 别在低功耗 + 看门狗同时开的场景里写 Flash |
| 7 | **DMA 传了一口就被打断** | 深度睡眠关 AHB/APB，DMA 无法搬运 | 睡前等 DMA 完成标志 |
| 8 | **醒来后外设"半死不活"** | 深度睡眠/待机后外设寄存器状态改变（时钟被关） | 醒来重新 `SystemInit()` + 重新初始化受影响的片外器件（OLED、PCF8563、Flash 的 CS 电平） |

> **一句话总结**：**加省电模式不是"加一个函数"，而是"给整个系统加一条新状态"**——
> 你必须回答"睡的时候谁在跑、谁负责叫醒我、醒来后谁需要重新初始化"。
> 这与第 05 篇"用状态机代替 `while(1)`"是同一个思路，只是这次状态叫"睡/醒"。

---

## 八、排查清单

| # | 现象 | 最可能的原因 |
| --- | --- | --- |
| 1 | 写了 `PMU_CTL` 但"没有任何效果" | **PMU 时钟没开**（`rcu_periph_clock_enable(RCU_PMU)` / `RCU_APB1EN_PMUEN`） |
| 2 | RTC 时间写不进去 | 备份域写保护没解（`pmu_backup_write_enable()`，§2.2） |
| 3 | 频率切到 168 MHz 后死机/不稳定 | `PMU_CTL_LDOVS` 或 `HDEN/HDS` 没做/没等标志（§2.1） |
| 4 | 深度睡眠醒来后串口乱码、延时变长 | **忘了 `SystemInit()`**（实际主频 16 MHz，代码以为 168 MHz） |
| 5 | 深度睡眠进不去也醒不来 | NVIC 优先级设置（§7 第 4 条，`PRE2_SUB2` 下的抢占优先级约束） |
| 6 | 待机模式"睡下去就没了" | 唤醒源没使能（`pmu_wakeup_pin_enable()`）或 PA0 浮空无上拉 |
| 7 | 睡眠一下就醒、反复 | 有中断一直在触发（EXTI 伪中断——第 06 篇 PA0 双边沿问题） |
| 8 | 低功耗电流不降 | 还有外设在跑：LED（第 02 篇，灯没关）、LCD 背光、OLED 一直刷屏、看门狗 |

---

## 九、自测题

1. `PMU_CTL_LDOVS`、`PMU_CTL_HDEN`、`PMU_CTL_HDS` 三个位各干什么？为什么顺序是"先 LDOVS，最后 HDS"？
2. `RCU_APB1EN_PMUEN` 不置位会怎样？为什么这种错误"不报错"？
3. 三个电源域各供了哪些模块？睡眠/深度睡眠/待机分别关掉哪些？
4. 深度睡眠醒来后为什么要调 `SystemInit()`？不调会出现什么现象？
5. 为什么 `pmu_backup_write_enable()` 是"改 RTC 的前置动作"？它对应哪个寄存器位？
6. `WFI` 和 `WFE` 的差别是什么？本工程用的是哪个？
7. 本工程开 `NVIC_PRIGROUP_PRE2_SUB2` 时，深度睡眠的唤醒中断优先级有什么限制？
8. 睡眠期间 SysTick 会不会继续计数？这对 `delay_1ms()` 意味着什么？

### 练习题

1. **验证 §2.1**：在 `system_clock_168m_8m_hxtal()` 里把 `PMU_CTL_LDOVS` 那一行注释掉，看程序还能不能正常跑到 168 MHz（**注意：这是危险实验，先备份，失败就还原**）。
2. **加一个睡眠按钮**：用 KEY1（第 03 篇）触发进入睡眠模式，用 KEY2（EXTI）唤醒，串口打印"睡前/醒后"各一次。
3. **深度睡眠 + 时钟自检**：进深度睡眠前打印 `SystemCoreClock`，醒来后（`SystemInit()` 之后）再打印一次，验证是否恢复 168 MHz。
4. **RTC 定时唤醒**：用内部 RTC 闹钟（第 11 篇）每 10 秒唤醒一次，醒来点亮 LED 1 秒再睡——**这正是同类产品"低功耗手表"的最小骨架**。
5. **功耗预算表**：把本板所有能"耗电"的模块列出来（LED 8 颗、LCD 背光、OLED、蜂鸣器、马达、Flash、两个 RTC），标注怎么关，估算最低能到多少电流。

---

## 附：本篇对应的资料（无提交）

| 类型 | 文件 |
| --- | --- |
| 教材（2026-10-07 新增） | `Textbook/PMU/电源管理单元.mhtml` |
| 参考笔记（2026-10-07 新增） | `Note/PMU.md` |
| 工程中的 PMU 代码（**已存在，非新增**） | `Firmware/CMSIS/GD/GD32F4xx/Source/system_gd32f4xx.c`（601/602、622~630 行）<br>`Hardware/msp_rtc/msp_rtc.c`（11~17 行） |

## 参考笔记

- `../../../NOTE/Note/PMU.md` —— PMU 整理版笔记（三个电源域、三种省电模式、WFI/WFE、串口切换省电模式的完整案例）
- `../../../NOTE/Textbook/PMU/电源管理单元.mhtml` —— 教材原文（电源域框图、模式总结表、NVIC 优先级注意点）
- `../../../NOTE/Doc/GD32F407/GD32F4xx_User_Manual_Rev3.0_CN.pdf` —— 用户手册的 **PMU 章节**（`PMU_CTL`/`PMU_CS` 每一位的定义，本文 §2.1 的三个位就出在这里）
- 相关篇目：[11 RTC](11-RTC实时时钟.md)（备份域与写保护）、[12 看门狗](12-看门狗.md)（待机也不关的狗）、[14 专题·时钟树与总线](14-专题-时钟树与总线.md)（`SystemInit()` 与 168 MHz 的完整链路）、[17 PCF8563](17-PCF8563外部RTC.md)（外部备电方案）、[06 外部中断](06-外部中断EXTI.md)（唤醒源与 PA0 浮空问题）、[23 查手册](23-专题-如何查手册与数据手册.md)（"改频率要查哪张表"）

> 本笔记仅作学习整理。本模块**尚无对应 git 提交**，第二章的代码位置、第五章的三个模板均标注了出处，可自行核对。
