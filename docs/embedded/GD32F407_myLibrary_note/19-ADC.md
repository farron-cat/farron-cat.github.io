# 19 · ADC 模数转换（芯片温度 + 多通道 + DMA）· 学习笔记

> 这一篇讲 **5 次提交**：`b80ce12`（采样芯片内部温度，跑通单通道）→ `d502d82`（多通道 + 扫描模式 + EOC）→ `f8b4b85`（多通道 + DMA 搬运）→ `067922c`（把裸写在 `main.c` 的实现删掉）→ `d961737`（抽成 `Hardware/msp_adc`，新增 NTC 通道，并修回温度通道的采样时间）。
> 它把前面几篇串了起来：**ADC 的 DMA 请求复用第 08 篇的 DMA**，**温度公式来自数据手册**（第 23 篇会专门讲怎么查）。
> 整理日期：2026-10-10（初版 10-06）　｜　提交范围：`b80ce12`、`d502d82`、`f8b4b85`、`067922c`、`d961737`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想知道怎么读电压 | 第二章（三步走 + 公式）+ 第八章速查表 |
| **读出来的值不准/乱跳** | 第五章（采样时间）+ 第九章排查清单 |
| 想搞懂多通道怎么配 | 第四章（扫描模式 + 通道序列）——**本篇核心** |
| 想搞懂 DMA 怎么配合 | 第六章（和第八篇联动） |
| 准备面试 | 采样/量化/编码、分辨率与参考电压、采样时间为什么重要 |

## 知识点地图

```
ADC 模数转换
├── 三步走            采样 → 量化 → 编码
├── 关键参数          分辨率 12 位（4096 级）、参考电压 3.3 V、ADC 时钟、采样时间
├── 电压公式          V = code × Vref / 4096
├── 温度公式          T = (V25 − V) / Avg_Slope + 25（来自数据手册，V25=1.45V，斜率 4.1mV/℃）
├── 两种通道          规则通道（Routine）+ 插入通道（Inserted，本工程未用）
├── 扫描模式          一次触发，按序列把多个通道全部转换一遍
├── EOC 行为          ADC_EOC_SET_CONVERSION：每个通道转换完都置标志（否则只在一轮结束时置）
├── 内部通道          温度/Vref 挂在通道 16~18，**必须单独开关**（adc_channel_16_to_18）
├── 连续转换          不停地下一次转换（配合 DMA 循环搬运 → 主循环随时读到最新值）
├── 校准              adc_calibration_enable()，开 ADC 后要 delay 1 ms 再校准
└── 与 DMA 配合       P2M + 循环模式 + 16 位宽度；子外设 SUBPERI0（第 08 篇的查表法）
```

## 学习目标

- 说清"采样 → 量化 → 编码"三步，并算出 12 位 ADC 的分辨率（电压步长）
- 会写电压换算公式，也知道它为什么长这样
- 理解"采样时间"的作用，知道**内部温度传感器对采样时间有硬要求**
- 掌握多通道采集的两种方案（不用 DMA / 用 DMA），并说清各自的适用场景
- 会把 ADC 和 DMA 接起来（复用第 08 篇的 DMA 知识）
- 学会从数据手册里找"温度传感器的公式和参数"

---

## 一、ADC 在做什么

**把连续变化的电压，变成 CPU 能处理的整数**。

```
真实世界（连续）                     数字世界（离散）
    3.3V ┤                            4095 ┤
         │   ╱╲                            │      ╱╲
         │  ╱  ╲                           │     ╱  ╲
    0V   ┤ ╱    ╲                     0    ┤────╲──╱───╲────
         └───────→ 时间                     └───────→ 采样点
```

### 1.1 三步走

| 步骤 | 做什么 | 关键点 |
| --- | --- | --- |
| **采样** | 用采样保持电容"抓"住某一瞬间的电压 | **需要足够的采样时间**让电容充满（本章重点） |
| **量化** | 把"抓到的电压"归到最近的一个刻度上 | 刻度的个数 = 2^分辨率 |
| **编码** | 把这个刻度编号存成数字 | 结果就是一个整数 code |

### 1.2 分辨率的含义（必须会算）

```
12 位分辨率 → 2^12 = 4096 个刻度（0 ~ 4095）
参考电压 Vref = 3.3 V

每个刻度代表的电压 = 3.3 V / 4096 ≈ 0.806 mV
⇒ 也就是说：ADC 分辨不出小于 0.8 mV 的变化
```

**反过来，从 code 算电压**：

```c
float vol = (encode * 3.3f) / 4096;
```

| code | 电压 |
| --- | --- |
| 0 | 0 V |
| 2048 | ≈ 1.65 V（中点） |
| 4095 | ≈ 3.299 V |

**注意分母是 4096 而不是 4095**——因为"刻度数"是 4096（`code` 从 0 到 4095）。**写成 4095 会有一点点偏差**（虽然很小），工程上两种写法都能见到，**但要知道自己在写什么**。

**本工程的两个被测对象**：

| 被测 | 引脚 / 通道 | 说明 |
| --- | --- | --- |
| **电位器** | **PC4 / `ADC_CHANNEL_14`** | 外部模拟输入，用来做"可调电压"实验 |
| **芯片内部温度** | **`ADC_CHANNEL_16`** | **不用外接**，读芯片自己测的温度（精度不高） |

---

## 二、温度怎么算出来的（数据手册公式）

**芯片内部温度传感器的原理**：它输出一个**随温度线性变化**的电压，ADC 把它采回来，再反推温度。

**数据手册给的两个参数**（`Doc/GD32F407/GD32F407xx_Datasheet_Rev2.7.pdf` 表 4-36）：

| 参数 | 值 | 含义 |
| --- | --- | --- |
| **V25** | **1.45 V** | 25 ℃ 时传感器输出的电压 |
| **Avg_Slope** | **4.1 mV/℃** | 平均斜率（温度每升高 1 ℃，电压下降 4.1 mV） |
| `TL` | ±1.5 ℃ | 绝对精度（**看清楚了：本来就只保证 ±1.5℃**） |
| `tS_temp` | **17.1 μs** | **温度通道要求的最小采样时间**（第五章要用到） |

**公式**：

```
温度(℃) = (V25 − V_sense) / Avg_Slope + 25
```

**代码实现**（`main.c` 的 `msp_adc_get()`）：

```c
// 获取内部温度
encode = adc_results[1];

// 根据基准电压计算实际电压
vol = (encode * 3.3f) / 4096;

// 计算得到温度值 (datasheet中找到公式)
// (v25 - v) / avg_slope + 25
float temp = (1.45f - vol) * 1000 / 4.1f + 25;
printf("temp = %.2f\r\n", temp);
```

**那个 `* 1000` 是新手最容易漏的一步**：

```
公式要求「电压差 / 斜率」，但两者的单位不统一：
    V25 - V  →  单位是 V（比如 0.05 V）
    Avg_Slope → 单位是 mV/℃（4.1）

0.05 / 4.1 = 0.0122  ← 错的，差了 1000 倍
0.05 × 1000 / 4.1 = 12.2 ℃  ← 对的

所以必须先 ×1000，把 V 换算成 mV。
```

> **⚠️ 两个必须知道的现实**：
> 1. **精度只有 ±1.5 ℃**（还是典型值），**不要拿它当温度计用**，只能当"芯片大概热不热"的参考。
> 2. **V25 = 1.45 V 是"典型值"**，不同芯片的工艺分散很大（可能 1.38 V 也可能 1.52 V）——这是**最大的误差来源**。想测准需要"单点校准"：在已知温度下读一次，反推你这颗芯片的实际 V25。
> 这种"公式里的常数其实是典型值，实际需要校准"的情况，在传感器类器件里非常普遍——**也是"读手册时要看"典型值"还是"保证值"**的经典案例（第 23 篇）。

---

## 三、提交 `b80ce12`：单通道 + 轮询（先跑通）

**提交信息**：`[更新] ADC测试 芯片温度`（`main.c` +60 行，`.eide/eide.yml` 加 `gd32f4xx_adc.c`；同时把 `README` 改名成 `README.md`）

**第一次实现用的是最朴素的方式**：软件触发 + 死等 EOC + 读寄存器。

```c
void msp_adc_config(void)
{
    /* 重置 */
    adc_deinit();
    /* 使能时钟 */
    rcu_periph_clock_enable(RCU_ADC0);
    /* 设置分频系数 21M */
    adc_clock_config(ADC_ADCCK_PCLK2_DIV4);
    /* 设置同步模式(独立模式) */
    adc_sync_mode_config(ADC_SYNC_MODE_INDEPENDENT);
    /* 设置单次模式还是连续转换(单次转换) */
    adc_special_function_config(ADC0, ADC_CONTINUOUS_MODE, DISABLE);
    /* 设置扫描还是非扫描模式(非扫描模式) */
    adc_special_function_config(ADC0, ADC_SCAN_MODE, DISABLE);
    /* 设置是否打开插入通道(不打开) */
    adc_special_function_config(ADC0, ADC_INSERTED_CHANNEL_AUTO, DISABLE);
    /* 设置分辨率 */
    adc_resolution_config(ADC0, ADC_RESOLUTION_12B);
    /* 设置数据对齐 */
    adc_data_alignment_config(ADC0, ADC_DATAALIGN_RIGHT);

    /* 设置转换通道个数 */
    adc_channel_length_config(ADC0, ADC_ROUTINE_CHANNEL, 1);
    /* 设置转换哪一个通道以及所处序列位置 */
    adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_16, ADC_SAMPLETIME_480);
    // 内部通道需要单独打开
    adc_channel_16_to_18(ADC_TEMP_VREF_CHANNEL_SWITCH, ENABLE);
    /* 使能ADC */
    adc_enable(ADC0);
    /* 内部校准(需要delay等待) */
    delay_1ms(1);
    // 校准
    adc_calibration_enable(ADC0);
}

void msp_adc_get(void)
{
    // 将采集放入转换通道
    adc_software_trigger_enable(ADC0, ADC_ROUTINE_CHANNEL);
    // 等待EOC转换完成标志
    while (adc_flag_get(ADC0, ADC_FLAG_EOC) == RESET)
        ;
    // 读取转换结果 规则通道寄存器
    uint16_t encode = adc_routine_data_read(ADC0);
    ...
}
```

### 3.1 每个配置项在说什么

| 配置 | 取值 | 含义 |
| --- | --- | --- |
| `adc_clock_config(ADC_ADCCK_PCLK2_DIV4)` | **21 MHz** | ADC 时钟 = PCLK2(84 MHz) ÷ 4。注释写「要小于 49 MHz」→ 21 MHz 安全 |
| `adc_sync_mode_config(INDEPENDENT)` | 独立模式 | GD32F4 有多个 ADC，这里只用一个，各自独立工作 |
| `ADC_CONTINUOUS_MODE` | `DISABLE` | **单次转换**：触发一次转一次 |
| `ADC_SCAN_MODE` | `DISABLE` | **非扫描**：只转序列里的第 1 个通道 |
| `ADC_INSERTED_CHANNEL_AUTO` | `DISABLE` | 不用插入通道组（本工程全用规则通道） |
| `adc_resolution_config(ADC_RESOLUTION_12B)` | 12 位 | 4096 级 |
| `adc_data_alignment_config(ADC_DATAALIGN_RIGHT)` | 右对齐 | 结果放在 16 位寄存器的低位，**方便直接当数值用** |
| `adc_channel_length_config(..., 1)` | 1 个通道 | 规则序列长度为 1 |
| `adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_16, ADC_SAMPLETIME_480)` | 序列第 0 位 = 通道 16 | 通道 16 = 内部温度 |
| `adc_channel_16_to_18(..., ENABLE)` | 打开 | **内部通道（16~18）默认关闭，必须单独开** |
| `delay_1ms(1)` + `adc_calibration_enable()` | 校准 | 开 ADC 后要等一小会儿，再做校准 |

**三个容易漏的点**：

| 点 | 说明 |
| --- | --- |
| **ADC 时钟不能太高** | 本工程 21 MHz（注释说上限 49 MHz）。**忘了配置的话默认分频可能超标** → 转换结果不可信 |
| **内部通道要单独开** | `adc_channel_16_to_18(ADC_TEMP_VREF_CHANNEL_SWITCH, ENABLE)`——温度/Vref 通道默认是**断开的**，不开就永远读到 0 |
| **校准必须先 delay** | 注释写「内部校准(需要delay等待)」；手册也要求 ADC 使能后等一段时间再校准 |

### 3.2 触发一次、读一次

```c
adc_software_trigger_enable(ADC0, ADC_ROUTINE_CHANNEL);   // 软件触发
while (adc_flag_get(ADC0, ADC_FLAG_EOC) == RESET);          // 死等转换完成
uint16_t encode = adc_routine_data_read(ADC0);              // 读结果
```

**这是"轮询式"采集**——**简单，但有两个毛病**：

| 毛病 | 说明 |
| --- | --- |
| **阻塞** | `while` 死等期间什么都干不了（虽然一次转换只有 1~23 μs，不长） |
| **容易卡死** | 如果 ADC 没配好（时钟、通道、校准），`EOC` 永远不来 → **程序卡死在这里**（和第 15 篇硬件 I2C 的问题一样，**这里没有超时保护**） |

---

## 四、提交 `d502d82`：多通道 + 扫描模式

**提交信息**：`[更新] 多通道ADC 配置扫描模式和每个通道转换完成产生EOC`

**需求变成两个通道**：电位器（通道 14）+ 芯片温度（通道 16）。

### 4.1 改动逐条看

```c
+    // 配置GPIO
+    rcu_periph_clock_enable(RCU_GPIOC);
+    gpio_mode_set(GPIOC, GPIO_MODE_ANALOG, GPIO_PUPD_NONE, GPIO_PIN_4);   // ← 模拟模式
+
     ...
-    adc_special_function_config(ADC0, ADC_SCAN_MODE, DISABLE);
+    adc_special_function_config(ADC0, ADC_SCAN_MODE, ENABLE);            // ← 打开扫描
     ...
-    adc_channel_length_config(ADC0, ADC_ROUTINE_CHANNEL, 1);
+    adc_channel_length_config(ADC0, ADC_ROUTINE_CHANNEL, 2);             // ← 2 个通道
-    adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_16, ADC_SAMPLETIME_480);
+    adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_14, ADC_SAMPLETIME_15);  // 序列 0 = 电位器
+    adc_routine_channel_config(ADC0, 1, ADC_CHANNEL_16, ADC_SAMPLETIME_15);  // 序列 1 = 温度
     // 内部通道需要单独打开
     adc_channel_16_to_18(ADC_TEMP_VREF_CHANNEL_SWITCH, ENABLE);
+    adc_flag_clear(ADC0, ADC_FLAG_EOC);
+    // 配置常规通道每一个通道转换完成都会产生EOC标志位
+    adc_end_of_conversion_config(ADC0, ADC_EOC_SET_CONVERSION);
```

### 4.2 扫描模式 + 通道序列

**"扫描模式"就是把序列里的通道挨个转换一遍**：

```
序列：[0] = 通道 14（电位器）  →  [1] = 通道 16（温度）

一次触发 →
    ① 转换通道 14 → 结果进 ADC_RDATA，置 EOC
    ② 转换通道 16 → 结果进 ADC_RDATA，置 EOC
    （扫描模式下"转完一轮"还会置 EOIC/EOC 的轮末标志）
```

**`ADC_EOC_SET_CONVERSION` 这个配置非常关键**：

| 取值 | EOC 什么时候置位 | 后果 |
| --- | --- | --- |
| 默认（`ADC_EOC_SET_SEQUENCE`） | **一轮序列全部转完**才置一次 | 多通道时只能读到**最后一个**通道的结果 |
| **`ADC_EOC_SET_CONVERSION`**（本工程） | **每个通道转完都置** | 可以逐个读，但**必须及时读走**，否则被下一个覆盖 |

**第 08 篇的 DMA 正好解决"及时读走"的问题**——这就是第六次提交要做的事。

### 4.3 ⚠️ 一处被改坏的采样时间（值得自己复核）

**对比两次提交的参数**：

```diff
-    adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_16, ADC_SAMPLETIME_480);   // 温度通道，480 周期
+    adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_14, ADC_SAMPLETIME_15);   // 电位器
+    adc_routine_channel_config(ADC0, 1, ADC_CHANNEL_16, ADC_SAMPLETIME_15);   // 温度通道变成 15 周期！
```

**算一下时间**（ADC 时钟 21 MHz）：

```
采样时间 15 周期  → 15 / 21 MHz ≈ 0.71 μs
采样时间 480 周期 → 480 / 21 MHz ≈ 22.9 μs

而数据手册要求温度通道的最小采样时间 tS_temp = 17.1 μs
```

| 通道 | 原来 | 现在 | 是否满足手册 |
| --- | --- | --- | --- |
| 电位器（外部） | — | 15 周期（0.71 μs） | 外部信号源阻抗低时没问题 |
| **温度（内部）** | **480 周期（22.9 μs）✅** | **15 周期（0.71 μs）❌** | **不满足 17.1 μs 的要求** |

**结论**：**加第二个通道时，把温度通道的采样时间从"够用"改成了"不够用"**——这会直接导致温度读数不准（偏低或跳动）。

**为什么内部温度传感器需要这么长的采样时间？** 因为它内部等效阻抗高（不像电位器可以直接驱动），**采样电容需要更长时间才能充到目标电压**。

**正确做法**：**采样时间要按通道单独设**——外部电位器可以短（快），温度通道必须长（准）：

```c
adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_14, ADC_SAMPLETIME_15);   // 快
adc_routine_channel_config(ADC0, 1, ADC_CHANNEL_16, ADC_SAMPLETIME_480);  // 慢（满足 17.1 μs）
```

> **这正是"多通道 ADC"最容易被忽视的细节**：**采样时间是"每个通道"的参数，不是"整个 ADC"的参数**。手册里那张"各通道最小采样时间"表，就是为了让你按通道分别配。（更多"怎么查这张表"见第 23 篇。）
>
> ✅ **后续**：`d961737`（10-10，本模块第四次提交）**已把温度通道改回 `480` 周期**，并在序列里加入第三个通道（NTC）。详见 §5.4。

**总转换时间**（按手册的一般算法）：

```
一个通道的转换时间 ≈ (采样周期数 + 12个转换周期) / ADC时钟

15 周期档：  (15 + 12) / 21 MHz ≈ 1.29 μs
480 周期档： (480 + 12) / 21 MHz ≈ 23.4 μs
```

---

## 五、提交 `f8b4b85`：交给 DMA（本模块的收尾）

**提交信息**：`[更新] 多通道ADC 使用DMA搬运`

### 5.1 DMA 侧配置（复用第 08 篇的知识）

```c
uint16_t adc_results[2];      // ← DMA 的目的地：2 个通道各一个 uint16_t

// P=>M
void msp_adc_dma_config(void)
{
    // 重置DMA
    dma_deinit(DMA1, DMA_CH0);
    // 1.开启外设时钟
    rcu_periph_clock_enable(RCU_DMA1);
    // 2.配置DMA
    dma_single_data_parameter_struct init_struct;
    dma_single_data_para_struct_init(&init_struct);

    init_struct.direction = DMA_PERIPH_TO_MEMORY;
    init_struct.memory0_addr = (uint32_t)adc_results;
    init_struct.periph_addr = (uint32_t)(&ADC_RDATA(ADC0));   // ← ADC 规则数据寄存器

    init_struct.periph_memory_width = DMA_PERIPH_WIDTH_16BIT;  // ← 16 位！ADC 结果是 12 位右对齐
    init_struct.number = 2;                                    // ← 搬 2 个

    init_struct.periph_inc = DMA_PERIPH_INCREASE_DISABLE;      // 外设地址固定
    init_struct.memory_inc = DMA_MEMORY_INCREASE_ENABLE;       // 内存地址递增
    init_struct.circular_mode = DMA_CIRCULAR_MODE_ENABLE;      // ★ 循环模式！
    init_struct.priority = DMA_PRIORITY_LOW;

    dma_single_data_mode_init(DMA1, DMA_CH0, &init_struct);

    // 配置DMA通道的子外设 查表
    dma_channel_subperipheral_select(DMA1, DMA_CH0, DMA_SUBPERI0);
    // 清理DMA搬运完成标志位
    dma_flag_clear(DMA1, DMA_CH0, DMA_FLAG_FTF);

    // 3.启动DMA传输
    dma_channel_enable(DMA1, DMA_CH0);
}
```

**和第 08 篇的串口 P2M 对比，只有三处不同**：

| 字段 | 串口接收（第 08 篇） | **ADC（本篇）** |
| --- | --- | --- |
| `periph_addr` | `&USART_DATA(usartx)` | **`&ADC_RDATA(ADC0)`** |
| `periph_memory_width` | `8BIT` | **`16BIT`**（ADC 结果是 16 位寄存器） |
| `number` | 缓冲区大小（1024） | **通道个数（2）** |
| **`circular_mode`** | `DISABLE` | **`ENABLE`（循环！）** |
| 子外设 | `DMA_SUBPERI4`（USART） | **`DMA_SUBPERI0`（ADC0）** |

**`circular_mode = ENABLE` 是这次的关键**：

```
普通模式：搬完 2 个就停，要重新 dma_channel_enable() 才能再搬
循环模式：搬完 2 个自动从头开始，**永不停歇**

⇒ 配合 ADC 的"连续转换"：
   ADC 一直转 → 每转完一个通道发一次 DMA 请求 → DMA 一直搬
   ⇒ adc_results[0] 和 adc_results[1] 永远是最新值
   ⇒ 主循环随时读就行，不用等、不用清标志、不用重启 DMA
```

**这就是"后台自动采集"的经典架构**：

```
ADC（连续转换）──DMA 请求──→ DMA（循环搬运）──→ adc_results[2]
                                                    ↑
                                          主循环随时读（永远最新）
```

### 5.2 ADC 侧的三处改动

```diff
-    adc_special_function_config(ADC0, ADC_CONTINUOUS_MODE, DISABLE);
+    adc_special_function_config(ADC0, ADC_CONTINUOUS_MODE, ENABLE);      // ① 连续转换
     ...
-    // 配置常规通道每一个通道转换完成都会产生EOC标志位
-    adc_end_of_conversion_config(ADC0, ADC_EOC_SET_CONVERSION);
+    // // 配置常规通道每一个通道转换完成都会产生EOC标志位
+    // adc_end_of_conversion_config(ADC0, ADC_EOC_SET_CONVERSION);          // ② 不再依赖 EOC
+
+    /* 配置DMA */
+    // 每个通道转换完成都会产生DMA搬运请求
+    adc_dma_request_after_last_disable(ADC0);                               // ③ DMA 请求时机
+    adc_dma_mode_enable(ADC0);
     ...
     adc_calibration_enable(ADC0);
+
+    // 将采集放入转换通道
+    adc_software_trigger_enable(ADC0, ADC_ROUTINE_CHANNEL);                 // ④ 触发一次就够
```

**四个改动各解决什么**：

| 改动 | 作用 |
| --- | --- |
| **连续转换 ENABLE** | 触发一次后 ADC 自己循环转换，**不用每次软件触发** |
| **不再用 EOC** | 结果由 DMA 搬走，程序不用再轮询 EOC（**消除了阻塞和卡死风险**） |
| **`adc_dma_request_after_last_disable()`** | 让 DMA 请求"**每次转换后**都产生"，而不是"等一轮结束"（对应 `ADC_EOC_SET_CONVERSION` 的语义） |
| **软件触发只调一次** | 放在配置最后，启动后就一直跑 |

**"软件触发一次就够"和"连续转换"是一对**：

```
单次 + 软件触发 → 每读一次要触发一次（原来的写法）
连续 + 软件触发一次 → 之后 ADC 自己转，DMA 自己搬 ✅
```

### 5.3 读取端：从"触发+等待"变成"直接读"

```diff
 void msp_adc_get(void)
 {
-    // 将采集放入转换通道
-    adc_software_trigger_enable(ADC0, ADC_ROUTINE_CHANNEL);
-    // 等待EOC转换完成标志
-    while (adc_flag_get(ADC0, ADC_FLAG_EOC) == RESET);
-    adc_flag_clear(ADC0, ADC_FLAG_EOC);
-    uint16_t encode = adc_routine_data_read(ADC0);
     ...
 }
```

**最终版本（`main.c` 里）**：

```c
void msp_adc_get(void)
{
    // 获取电位器
    uint16_t encode = adc_results[0];
    float vol = (encode * 3.3) / 4096;
    printf("vol:%f\n", vol);

    // 获取内部温度
    encode = adc_results[1];

    // 根据基准电压计算实际电压
    vol = (encode * 3.3f) / 4096;

    // 计算得到温度值 (datasheet中找到公式)
    // (v25 - v) / avg_slope + 25
    float temp = (1.45f - vol) * 1000 / 4.1f + 25;
    printf("temp = %.2f\r\n", temp);
}
```

**函数体里完全没有"启动/等待"了**——只是读一个全局数组、做两次换算。**这就是 DMA + 循环模式带来的"零等待"体验**（和第 08 篇串口 DMA 是同一个思想）。

---

### 5.4 `d961737`（10-10 20:19）：抽成模块，并修回温度通道的采样时间

> 这一笔提交（`msp_adc` + `bsp_ntc`）的完整分析见 **[第 27 篇](27-NTC热敏电阻测温.md)**，这里只记与 ADC 主线相关的四点。

**① 从 `main.c` 搬进 `Hardware/msp_adc/`**（第 01 篇那条老路的第 N 次复现）：

| 变化 | 之前（裸写） | 之后（模块） |
| --- | --- | --- |
| 配置函数 | `main.c` 的 `msp_adc_dma_config()` / `msp_adc_config()` | `msp_adc.c` 内的私有函数，由 `msp_adc_init()` 串联 |
| 数据缓冲 | `main.c` 的全局 `uint16_t adc_results[2]` | `msp_adc.c` 的 `static uint16_t encodes[3]` |
| 取数 | `main.c` 的 `msp_adc_get(void)`（**取数 + 换算 + printf 三合一**） | `msp_adc_get(uint8_t i)`（**只取数**，换算和打印移交上层） |

**② 通道数从 2 变成 3**，并**把温度通道的采样时间改回 480**：

```c
adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_14, ADC_SAMPLETIME_15);   // 电位器 PC4
adc_routine_channel_config(ADC0, 1, ADC_CHANNEL_16, ADC_SAMPLETIME_480);  // ★ 内部温度：改回 480 周期
adc_routine_channel_config(ADC0, 2, ADC_CHANNEL_1,  ADC_SAMPLETIME_15);   // ★ 新增：NTC PA1
```

也就是说，**§4.3 里标红的那个"❌ 不满足 17.1 μs"已经在这笔提交里被改回 `480` 周期（22.86 μs ✅）**。
——这正是"笔记里把问题记下来"的价值：问题不会自己消失，但**写清楚之后，下一次改动就有人（哪怕是未来的自己）知道该改哪里**。

**③ `main.c` 里 7 个函数被删（`067922c`，比这笔早 11 分钟）**，其中与 ADC 直接相关的是三个：
`msp_adc_dma_config()` / `msp_adc_config()` / `msp_adc_get()`。
**必须先删**的理由是一个真实隐患：**`main.c` 的 `msp_adc_get(void)` 与 `msp_adc.c` 的 `msp_adc_get(uint8_t)` 同名**，
C 不支持重载 → 同时存在就是**链接期重复符号**。这也让"迁移顺序"这个平时不起眼的问题露了头（第 27 篇 §3.3）。

**④ 顺手解决了一个资源冲突**：ADC 用 **`DMA1_CH0` + `SUBPERI0` + 循环模式**；
而第 08 篇的 DMA M2M 试验**也用 `DMA1_CH0`**（内存到内存 + 传输完成中断）。
两者配置互斥、**不可能同时生效**——所以 `067922c` 顺手把 `DMA_m2m_config()` 一起删了：
**"用不上的试验代码"原来还在偷偷占着一个 DMA 通道。**

---

## 六、四级台阶总结

| 台阶 | 提交 | 采集方式 | CPU 负担 | 问题 |
| --- | --- | --- | --- | --- |
| 1 | `b80ce12` | 单通道 + 软件触发 + **轮询 EOC** | 阻塞在 `while` | 卡死风险、只能一个通道 |
| 2 | `d502d82` | 双通道 + 扫描 + **每通道 EOC** | 还是要轮询，且**必须及时读走** | 采样时间被改坏（4.3 节） |
| 3 | `f8b4b85` | 双通道 + 扫描 + **连续转换 + DMA 循环** | **零等待**（读全局数组） | 采样时间仍需修正 |
| **4** | **`d961737`** | **三通道（+NTC）＋抽成 `Hardware/msp_adc`** | **零等待 + 零 `main.c`** | **温度采样时间已修回 480 ✅** |
| **5** | `0d729ce` | **四通道（+AD 按键，`ADC_CHANNEL_8` = PB0）** | 同上 | 见第 28 篇：`ADC_LEN` 3→4 |

**这条演进线和第 08 篇（DMA）完全同构**：

| | 串口接收（第 08 篇） | ADC（本篇） |
| --- | --- | --- |
| 痛点 | 每个字节一次中断，CPU 忙 | 每次转换都要等 EOC，CPU 忙 |
| 第一步 | 先跑通（RBNE 中断逐字节收） | 先跑通（轮询 EOC） |
| 第二步 | 加 IDLE 中断判包 | 加扫描模式 + 每通道 EOC |
| **解法** | **P2M DMA 后台搬运** | **P2M DMA + 循环模式** |
| 结果 | CPU 只处理"整包" | **CPU 完全不管采集** |

> **一句话记住**：**"外设自己能产生数据流"的场合（串口收、ADC 采）都该考虑用 DMA 接管搬运。** 这是嵌入式里最普遍的一种性能优化。

---

## 七、最终代码速查

```c
// --- main.c ---（本模块尚未封装成独立的 msp_adc.c）
uint16_t adc_results[2];              // [0] = 电位器（通道14），[1] = 内部温度（通道16）

void msp_adc_dma_config(void);        // DMA：P2M + 循环 + 16位 + 2个
void msp_adc_config(void);            // ADC：扫描 + 连续 + DMA 请求 + 校准
void msp_adc_get(void);               // 读 adc_results[] + 换算电压/温度
```

**参数速查表**：

| 项目 | 值 | 说明 |
| --- | --- | --- |
| ADC 时钟 | `ADC_ADCCK_PCLK2_DIV4` = **21 MHz** | 84 MHz ÷ 4；注释说上限 49 MHz |
| 分辨率 | **12 位** | 4096 级，1 级 ≈ 0.806 mV |
| 参考电压 | **3.3 V** | 代码里写死 |
| 数据对齐 | 右对齐 | 直接当整数用 |
| 通道数 | **2**（序列 0、1） | 扫描模式 |
| 通道 0 | **`ADC_CHANNEL_14`**（PC4） | 电位器，GPIO 需配 `GPIO_MODE_ANALOG` |
| 通道 1 | **`ADC_CHANNEL_16`** | 内部温度，**必须 `adc_channel_16_to_18(ENABLE)`** |
| 采样时间 | 现在都是 `ADC_SAMPLETIME_15` | ⚠️ 温度通道应改回 `ADC_SAMPLETIME_480` |
| 转换模式 | 连续（`ADC_CONTINUOUS_MODE` ENABLE） | 触发一次后自转 |
| 触发 | 软件触发（`adc_software_trigger_enable`） | 只在配置末尾调一次 |
| DMA | **DMA1_CH0 / `DMA_SUBPERI0`** | P2M，16 位，2 个，**循环模式** |

**两个必背公式**：

```
① 电压：  V = code × Vref / 4096 = code × 3.3 / 4096
② 温度：  T(℃) = (V25 − V) × 1000 / Avg_Slope + 25
                = (1.45 − V) × 1000 / 4.1 + 25
                ↑ V25 和 Avg_Slope 都来自数据手册（典型值）
```

**转换时间公式（联动第 13 篇）**：

```
单通道转换时间 ≈ (采样周期数 + 12) / ADC时钟
    15 周期档  → (15 + 12) / 21 MHz ≈ 1.29 μs
    480 周期档 → (480 + 12) / 21 MHz ≈ 23.4 μs
```

---

## 八、排查清单

| 现象 | 优先检查 |
| --- | --- |
| **读数一直是 0** | 内部通道没开（`adc_channel_16_to_18(ENABLE)`）；GPIO 没配 `GPIO_MODE_ANALOG`；通道号错 |
| **读数乱跳 / 不线性** | **采样时间太短**（尤其内部温度通道）；参考电压不稳；信号源阻抗太高 |
| 温度明显偏低/偏高 | 采样时间不足（先看 4.3 节）；V25 用的是典型值 1.45 V（工艺分散） |
| 温度值差 1000 倍 | 公式里漏了 `×1000`（V 与 mV 单位不统一） |
| **程序卡死在 `while(EOC)`** | ADC 没配好（时钟/校准/通道），EOC 永不来；**应加超时保护** |
| 多通道只读到最后一个通道的值 | 没开扫描模式；或没配 `ADC_EOC_SET_CONVERSION`（默认只在一轮结束置 EOC） |
| 多通道数据串位（电位器的值跑到温度里） | 通道序列顺序与 `adc_results[]` 下标对不上；DMA `number` 与通道数不一致 |
| 想读时数据总是旧的 | 没开连续转换；DMA 用了普通模式（搬完就停）；触发只调了一次但模式是单次 |
| 转换结果总是满量程 4095 | 输入电压超了 Vref；或通道配错接到了 VDD 上；GPIO 配成了推挽输出 |
| ADC 时钟超限 | 忘了 `adc_clock_config()`，默认分频可能 > 49 MHz |
| 上电第一次读数不准 | 没做校准（`adc_calibration_enable()`）或校准前没 `delay_1ms(1)` |
| DMA 搬回来的值始终为 0 | DMA 通道号/子外设选错（`SUBPERI0`）；`periph_memory_width` 不是 16 位 |
| 主循环执行变慢 | ADC 的 DMA 与串口/OLED 抢总线？其实 ADC 用独立通道；更可能是 `printf` 阻塞（第 04 篇） |

## 九、自测题

1. 12 位 ADC、3.3 V 参考电压时，1 个刻度代表多少电压？写出计算过程。
2. 电压换算公式的分母为什么是 4096 而不是 4095？
3. 温度公式里为什么要 `× 1000`？不乘会怎样？
4. `V25 = 1.45 V` 是什么量（典型值还是保证值）？它带来多大的误差？怎么提高精度？
5. 内部温度传感器需要多长的最小采样时间？为什么它比外部信号需要的时间长？
6. 采样时间是"每个通道"的参数还是"整个 ADC"的参数？本工程哪个通道配错了？
7. 扫描模式和"非扫描"的区别是什么？多通道为什么必须开扫描？
8. `ADC_EOC_SET_CONVERSION` 和默认行为有什么区别？多通道时不开它会怎样？
9. `adc_channel_16_to_18()` 是干什么的？不调用会读到什么？
10. 为什么校准前要先 `delay_1ms(1)`？
11. DMA 用循环模式（`circular_mode = ENABLE`）在这里有什么意义？
12. 为什么改成 DMA 之后，`msp_adc_get()` 里就不需要"触发 + 等 EOC"了？
13. ADC 的 DMA 用了哪个控制器、哪个通道、哪个子外设？为什么要"查表"？

## 十、练习题

1. **修正采样时间**：把温度通道（通道 16）的采样时间改回 `ADC_SAMPLETIME_480`，对比修改前后温度读数的稳定性（应该明显改善）。
2. **算最小采样时间**：根据手册的 `tS_temp = 17.1 μs` 和 ADC 时钟 21 MHz，算出**满足要求的最小采样档位**（已知可选 3/15/28/56/84/112/144/480 周期）。
3. **加超时**：给"轮询式"读法加超时保护（回到 `d502d82` 的写法，体会不同）。
4. **上位机曲线**：把 `vol` 和 `temp` 通过串口按固定格式（如 CSV）持续输出，用串口绘图工具画出电位器电压曲线。
5. **单点校准温度**：把板子放在恒温环境（或用手捂到接近体温，再用温度计对照），反推你这颗芯片的 V25，替换公式里的 1.45。
6. **加通道**：再接入 ADC 的 `Vrefint`（内部参考电压通道）测一次，用它来反推真实的 Vref（这是"不用外部基准也能提高精度"的常用技巧）。
7. **封装成驱动**：把这三块（`msp_adc_dma_config` / `msp_adc_config` / `msp_adc_get`）从 `main.c` 搬进 `Hardware/msp_adc/`，接口参照第 11 篇 `msp_rtc` 的风格。
8. **不用 DMA 的对照组**：用"扫描 + 每通道 EOC"的方式采 4 个通道（不用 DMA），体会"必须及时读走否则被覆盖"的紧张感。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `b80ce12` | 09-29 17:46 | [更新] ADC 测试 芯片温度 | `main.c` 新增 `msp_adc_config()` / `msp_adc_get()`：单通道（**通道 16 内部温度**）+ 非扫描 + 单次 + 软件触发 + 轮询 EOC；**采样时间 `ADC_SAMPLETIME_480`**；温度公式 *(1.45−V)×1000/4.1+25*；`.eide` 加 `gd32f4xx_adc.c`；`README` 改名 `README.md` |
| `d502d82` | 09-30 10:19 | [更新] 多通道 ADC 配置扫描模式和每个通道转换完成产生 EOC | 加 **PC4（通道 14）** 电位器 + `GPIO_MODE_ANALOG`；**开扫描模式**；通道数改 2；加 `adc_end_of_conversion_config(ADC_EOC_SET_CONVERSION)`；**⚠️ 两个通道的采样时间都改成 `ADC_SAMPLETIME_15`（温度通道不再满足手册 17.1 μs 要求）** |
| `f8b4b85` | 09-30 15:00 | [更新] 多通道 ADC 使用 DMA 搬运 | 新增 `msp_adc_dma_config()`：**P2M + 16 位 + 2 个 + 循环模式 + `DMA_SUBPERI0`**；ADC 侧改**连续转换**、`adc_dma_request_after_last_disable()` + `adc_dma_mode_enable()`、软件触发移到配置末尾只调一次；`msp_adc_get()` 去掉触发与等待，直接读 `adc_results[]` |
| **`067922c`** | 10-10 20:08 | [整理] 整理main函数 | **删除** `main.c` 的三个 ADC 函数（`msp_adc_dma_config` / `msp_adc_config` / `msp_adc_get`）与全局 `adc_results[]`、`DMA_m2m_config()` / `DMA1_Channel0_IRQHandler()`；`main.c` 453 → 264 行；新增 `Doc/整理操作参考.md`（内含"符号冲突 + DMA1_CH0 争用"两个高危项） |
| **`d961737`** | 10-10 20:19 | [更新] msp_adc bsp_ntc …封装 | 新建 `Hardware/msp_adc/`：`msp_adc_init()` = DMA 配置 + ADC 配置，数据存 `static encodes[3]`，对外只留 `msp_adc_get(i)`；**通道数 2 → 3**（新增 NTC PA1 / CH1）；**温度通道采样时间改回 `ADC_SAMPLETIME_480`**；新建 `Driver/bsp_ntc/`（查表法测温，见第 27 篇） |

**这个模块的四级台阶**（和 DMA 那条线同构）

| 台阶 | 提交 | 采集方式 | 遗留问题 |
| --- | --- | --- | --- |
| 1 | `b80ce12` | 单通道 + 轮询 | 阻塞、有卡死风险 |
| 2 | `d502d82` | 双通道 + 扫描 + EOC | **采样时间被改坏**、EOC 要及时读 |
| 3 | `f8b4b85` | 双通道 + 连续 + **DMA 循环** | 采样时间仍需修正 |
| **4** | **`d961737`** | **三通道 + 抽成模块** | **温度采样时间已修回 480**（无遗留） |
| **5** | `0d729ce` | **四通道（+ AD 按键）** | 见 [第 28 篇](28-AD按键ADKEY.md) |

## 参考笔记

- `../../../NOTE/Note/ADC.md` —— ADC 模数转换（完整整理版）
  - 第二章「ADC 的三步走：采样 → 量化 → 编码」= 本篇 1.1 节
  - 第四章「GD32F4 的 ADC 硬件结构」= 本篇 3.1 节的硬件背景
  - 第五章「ADC 开发流程：八步配置」= 本篇 3.1 节的配置顺序
  - 第六章「实战一：采样芯片内部温度」= 本篇第三章
  - 第七章「实战二：采样外部电位器」= 本篇第四章
  - 第八章「实战三：多通道采样（不用 DMA）」= 本篇第四章
  - 第九章「实战四：多通道 + DMA」= 本篇第五章
  - 第十章「配置速查表」= 本篇第七章
  - **第十二章第 1484 行附近**：V25 的工艺分散与"单点校准"方法 = 本篇第二章的 ⚠️
  - **最后一行**：`Doc/GD32F407/GD32F407xx_Datasheet_Rev2.7.pdf` **表 4-36** = V25 / Avg_Slope / `tS_temp` 的出处
- `../../../NOTE/Textbook/ADC/` —— 教材原文快照：`ADC.mhtml`、`ADC系统工作原理.mhtml`、`ADC开发🌟🌟🌟.mhtml`、`GD32F4之ADC查询.mhtml`
- `../../../NOTE/Doc/GD32F407/GD32F407xx_Datasheet_Rev2.7.pdf` —— **表 4-36**（温度传感器参数）与 ADC 电气特性表
- 第 08 篇（DMA）与本篇的 P2M 用法完全同构，建议对照阅读

> 本笔记仅作学习整理，内容来自本仓库真实提交记录与源码。
