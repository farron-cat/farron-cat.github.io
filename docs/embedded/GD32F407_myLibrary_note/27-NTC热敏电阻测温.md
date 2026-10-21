# 27 · NTC 热敏电阻测温（含 ADC 模块化）· 学习笔记

> 这一篇围绕 **1 次提交** `d961737`：新建 `Hardware/msp_adc/`（把裸写在 `main.c` 里的 ADC + DMA 配置抽成模块）与 `Driver/bsp_ntc/`（把"ADC 电压 → 电阻 → 温度"这段算法封装起来）。
> 它是第 19 篇（ADC）的**第二级台阶**：`b80ce12`/`d502d82`/`f8b4b85` 让 ADC"能跑"，`d961737` 让 ADC"归队 + 长出第一个真实传感器应用"。
> 整理日期：2026-10-10　｜　提交范围：`d961737`（前置：`b80ce12` `d502d82` `f8b4b85` `067922c`）

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想读一个温度 | 第六章速查：`bsp_ntc_get_tem()` |
| 温度读出来是常数/乱跳 | 第八章排查清单第 1~4 条 |
| 想搞懂"电压怎么变成温度" | 第二章（**查表法 vs B 值公式**） |
| 想搞懂 ADC+DMA 三通道是怎么串起来的 | 第四章 4.1~4.3 + 第 19 篇 |
| 想换一颗别的 NTC | 第二章表 + 练习题 1 |

## 知识点地图

```
NTC 测温（本篇）
├── 一、硬件：一颗 NTC + 一个分压电阻 + ADC        电路怎么接、公式怎么反推
├── 二、★ 两种换算方法                           B 值公式 vs 查表（本工程用查表）
│     2.1 B 值公式的推导与局限                     2.2 查表的表从哪来、怎么用
├── 三、提交演进                                 裸写在 main.c → 抽成 msp_adc → 长出 bsp_ntc
│     3.1 先删旧的（067922c）  3.2 再建新的（d961737）  3.3 ★ 迁移顺序的教训
├── 四、最终代码逐段解读                          msp_adc：DMA / ADC 配置 / 取数；bsp_ntc：搜索 / 换算
├── 五、采样时间与精度的账                        21 MHz、480/15 周期、17.1 µs
├── 六、最终代码速查
├── 七、遗留问题（3 个）                          除零、非 const 表、空初始化
├── 八、排查清单
└── 九、自测题 + 练习题
```

## 学习目标

1. 说清 NTC 分压电路，并独立推导出 `R = 10k × V / (3.3 − V)`。
2. 说出"查表法"相对"B 值公式"的优点与代价，并解释**为什么真实 NTC 不能用单一 B 值描述**。
3. 会算 ADC 的采样时间，并判断"某个通道的采样时间够不够"。
4. 看懂 ADC + **循环 DMA** 如何做到"主循环随便读、后台一直在采"。
5. 记住这次"先删旧、后建新"的迁移顺序带来的风险。

---

## 一、硬件：NTC + 分压 + ADC

### 1.1 NTC 是什么

**NTC = Negative Temperature Coefficient，负温度系数热敏电阻**：**温度升高 → 电阻下降**（和普通电阻相反）。
它是"用电学量测温度"最便宜的方案，广泛用于电池、电机、充电器、家电。

本板（依据 `Doc/硬件信息汇总.md` 的引脚表与 5.4 节）：

| 器件 | 引脚 | ADC 通道 | 用途 |
| --- | --- | --- | --- |
| **NTC 热敏电阻** | **PA1** | ADC0_IN1 | 测环境/器件温度（本篇主角） |
| 电位器（可调电阻） | PC4 | ADC0_IN14 | 手动调电压（练习用） |
| 内部温度传感器 | 芯片内部 | ADC0_IN16 | 测芯片结温（第 19 篇） |

### 1.2 电路与公式

NTC 不可能直接接到 ADC——ADC 只能读"电压"。所以用**分压**把电阻变成电压：

```
                    +3.3V
                      │
                    [ 10 kΩ ]      ← 板上固定电阻（上臂）
                      │
                      ├──────────► PA1（ADC0_IN1）
                      │
                    [ NTC ]        ← 电阻随温度变（下臂）
                      │
                     GND
```

**正向公式**（分压定律）：

$$V_{PA1} = 3.3 \times \frac{R_{ntc}}{10k + R_{ntc}}$$

**反向公式**（代码里用的就是它）：

$$R_{ntc} = 10k \times \frac{V_{PA1}}{3.3 - V_{PA1}}$$

**性质检查**（**这四行是理解 NTC 驱动的关键**）：

| 温度 | NTC 阻值 | PA1 电压 | 说明 |
| --- | --- | --- | --- |
| **越低** | **越大** | **越大（趋近 3.3 V）** | 低温 → 高电压 |
| **越高** | **越小** | **越小（趋近 0 V）** | 高温 → 低电压 |

> 所以：**"ADC 读数大 = 温度低"**——和大多数传感器的直觉相反，第一次调的时候很容易搞反。
> 也正因为如此，**NTC 断线（开路）会被读成"极低温"**（电压顶到 3.3 V），**短路则读成"极高温度"**——
> 这是 NTC 最经典的两个故障现象，排查时先怀疑接线（第八章第 1 条）。

---

## 二、★ 两种换算方法

ADC 给出的是 0~4095 的数字。要变成"℃"，有两条路。

### 2.1 路线一：B 值公式（数学法）

NTC 厂家会给一个 **B 值**（本类器件典型 3950 K），公式为：

$$\frac{1}{T} = \frac{1}{T_0} + \frac{1}{B}\ln\frac{R}{R_0}$$

其中 $T_0 = 298.15\ \text{K}$（25 ℃）、$R_0$ = 25 ℃ 时的阻值（本例 10 kΩ）、$T$ 用**开尔文**。

**优点**：不需要表，两行代码就能算，换器件只改 `B` 和 `R0`。
**缺点（关键）**：① 需要 `ln()`（浮点数学库，慢且吃空间）；② **真实器件的 B 值不是常数**。

**用本工程的表来验证第 ② 点**（顺手做一次真实数据核算）：

| 温区 | 表里的阻值 | 反推的等效 B |
| --- | --- | --- |
| 0 ℃ → 25 ℃ | 32110 Ω → 10000 Ω | **≈ 3800 K** |
| 25 ℃ → 50 ℃ | 10000 Ω → 3580 Ω | **≈ 3960 K** |

同一颗 NTC，两段温区算出的 B 差了 **160 K（约 4%）**。
**结论：B 值只是"某个温区内的近似"，用它算全程必然有系统误差。**
（这也解释了为什么"抄一个 B=3950 的公式"在实际产品里常常偏 1~2 ℃。）

### 2.2 路线二：查表 + 最近邻（本工程采用）

厂家通常会提供一张 **R-T 对照表**（每 1 ℃ 一个点，本工程取 **−55 ~ +125 ℃，共 181 项**）。

代码把这张表直接搬进数组，单位约定为 **电阻 × 100**（即 `3211` 表示 32.11 kΩ，步进 0.01 kΩ = 10 Ω）：

```c
uint16_t temp_table[] = {
    58354, // -55
    55464, // -54
    ...
    3211,  // 0
    ...
    1000,  // 25       ← 10 kΩ NTC 的标称点
    ...
    32,    // 125
};
```

换算就是三步（`bsp_ntc_get_tem()`）：

```
① 电压：vol = adc * 3.3 / 4096
② 电阻：r   = 10 * vol / (3.3 - vol)      单位 kΩ
③ 查表：temp = search_tem(r * 100)        把 r 变成"×100"再和表比
```

**优点**：① **零浮点数学库依赖**（只有一次除法）；② 精度 = 厂家表的精度，**天然含器件非线性**；
③ 温度范围可控、边界明确。

**代价**：① 占存储（181 × 2 B = **362 B**）；② 搜索是 **O(n)** 线性扫描（181 次比较 + 绝对值）。

`search_tem()` 的策略是**最近邻**（找表里和最接近的那一项，直接取它的温度）：

```c
int8_t search_tem(uint16_t r)
{
    uint8_t i = 1;
    uint8_t index = 0;                          // 最接近的索引
    uint16_t diff = abs(temp_table[0] - r);     // 最小的误差值（先假定第 0 项最接近）
    for (; i < sizeof(temp_table) / sizeof(temp_table[0]); i++)
    {
        if (abs(temp_table[i] - r) < diff)
        {
            diff = abs(temp_table[i] - r);
            index = i;
        }
    }
    return index - 55;                          // 索引 → 摄氏度（index 0 = -55 ℃）
}
```

四个细节：

| 细节 | 说明 |
| --- | --- |
| `index - 55` | 表是按 ℃ 顺序排的，所以"索引减 55"就是温度——**表的下标本身就是刻度** |
| `abs()` 用在 `uint16_t` 差值上 | `temp_table[i] - r` 会整型提升为 `int` 后再取绝对值，**不会因为无符号相减而炸**（这里写对了） |
| `uint8_t index` | 181 项刚好塞进 `uint8_t`（0~255）——**但如果以后把表扩到 >256 项，这里就静默溢出**（第七章第 2 条） |
| 最近邻的误差 | 相邻两项在低温段差几百、高温段只差几，所以**低温段分辨力差、高温段反而更细**（和 R-T 曲线的形状一致） |

> **为什么不用二分查找 / 插值？**
> 表是**按温度升序、电阻降序**排列的（单调），完全可以二分（O(log n)）或线性插值（精度更高）。
> 作者选最简单写法是**教学取舍**——181 项每次多花不了多少时间（几十微秒），
> 而"最近邻"的语义比插值更好理解。**练习题 2、3 就是让你做这两个升级。**

---

## 三、提交演进

### 3.1 第一站：裸写在 `main.c` 里（`b80ce12` → `f8b4b85`）

第 19 篇已经讲过这个过程：ADC 的寄存器配置、DMA 配置、取数、printf 全都堆在 `main.c`：
- `msp_adc_dma_config()`（DMA 配置）
- `msp_adc_config()`（ADC 配置）
- `msp_adc_get(void)`（取数 + 换算 + 打印）
- 全局变量 `uint16_t adc_results[2]`

**问题**：违反工程自己的两条硬约束（见 `Doc/整理操作参考.md` §0.2 引用 `README.md`）——
"引脚与时钟配置统一放 `Hardware/msp_*.c`"、"不要在 `main.c` 里操作寄存器"。

### 3.2 第二站：`067922c` 先把旧实现**删掉**（10-10 20:08）

这次 `[整理]` 提交把 `main.c` 从 **453 行砍到 264 行**（-284 行），删掉了 7 个函数：

```
- void DMA_m2m_config(void)        ← DMA 试验代码（第 08 篇）
- void DMA1_Channel0_IRQHandler(void)
- void msp_adc_dma_config(void)    ← 与 msp_adc.c 内的同名/重复实现
- void msp_adc_config(void)
- void msp_adc_get(void)           ← ★ 与 msp_adc.c 的 msp_adc_get(uint8_t) 同名！
- void msp_fwdgt_config(void)      ← 20:30 在 msp_fwdgt.c 里重生（第 12 篇）
- void msp_wwdgt_config(void)      ← 20:30 在 msp_wwdgt.c 里重生
```

**为什么必须先删**（`整理操作参考.md` §1.1 把它列为"高优先级隐患"）：

> `main.c` 的 `msp_adc_get(void)` 与 `msp_adc.c` 的 `msp_adc_get(uint8_t)` **函数名相同**。
> C 不支持重载，两者同时参与编译 → **链接期重复符号**（或某一方被静默覆盖）。
> 所以顺序必须是："**先删除 `main.c` 中的旧实现，再启用 `msp_adc.c`**"。

同时它新增了 `Doc/整理操作参考.md`（35 KB）——**把"整理方案"先写成文档、再动手改代码**。
（文档里逐行盘点现状、给出目标归属、规定验证清单，甚至列出了每个函数的 `git 提交来源`。）

### 3.3 第三站：`d961737` 建模块（10-10 20:19）

新建 4 个文件（+377 行）：

| 文件 | 内容 |
| --- | --- |
| `Hardware/msp_adc/msp_adc.c/.h` | `msp_adc_init()` = DMA 配置 + ADC 配置；`msp_adc_get(i)`；`encodes[3]` |
| `Driver/bsp_ntc/bsp_ntc.c/.h` | `temp_table[181]`、`search_tem()`、`bsp_ntc_init()`、`bsp_ntc_get_tem()` |

`main.c` 侧只剩一行初始化 + 一行取值：

```c
msp_adc_init();                              // 初始化
...
bsp_188_leds_set_num(bsp_ntc_get_tem());     // 主循环里读温度给数码管（第 26 篇）
```

> ⚠️ **迁移顺序的教训（值得单独记一笔）**
> 这三次提交的时间是：**20:08 删旧 → 20:19 建 `msp_adc` → 20:30 建看门狗模块**。
> 也就是说，在 **20:08~20:19 之间**，`main.c` 里的 `msp_adc_*` 已经删了、而 `msp_adc.c` 还没出现——
> **如果这时编译，会因为"函数未定义"而失败**（或者说：这个中间态是不可编译的）。
> 之所以没出问题，是因为删除时那些函数**恰好都已经是"死代码"**（`main()` 里调用它们的行早就被注释掉了），
> 所以删掉后能编过、只是功能缺失。
>
> **正确的迁移顺序应该是"先建新家、再搬进去、最后拆旧家"**（三步都有可编译的中间态）。
> 本次是"先拆后建"——**碰巧安全，不是设计安全**。自己动手时要避免这种"赌一把"的顺序。

---

## 四、最终代码逐段解读

### 4.1 `msp_adc_init()`：两段式

```c
void msp_adc_init()
{
    msp_adc_dma_config();   // 先把"搬运工"准备好
    msp_adc_config();       // 再开 ADC 并启动转换
}
```

**顺序有讲究**：DMA 必须先配好并 enable，ADC 一开始转换才有地方搬（否则前几次转换的数据会白丢/溢出）。

数据存在模块内部的静态数组里（**不再需要 `main.c` 的全局 `adc_results[]`**）：

```c
static uint16_t encodes[ADC_LEN];      // ADC_LEN = 4（2026-10-12 起）
...
uint16_t msp_adc_get(uint8_t i) { return encodes[i]; }   // 上层只读，不碰寄存器
```

### 4.2 DMA 配置（外设 → 内存，循环模式）

```c
static void msp_adc_dma_config()
{
    dma_deinit(DMA1, DMA_CH0);                    // 复位通道
    rcu_periph_clock_enable(RCU_DMA1);
    dma_single_data_parameter_struct init_struct;
    dma_single_data_para_struct_init(&init_struct);

    init_struct.direction = DMA_PERIPH_TO_MEMORY;                     // P2M
    init_struct.periph_addr = (uint32_t)(&ADC_RDATA(ADC0));           // 源：ADC 数据寄存器
    init_struct.memory0_addr = (uint32_t)encodes;                     // 目的：数组
    init_struct.periph_memory_width = DMA_PERIPH_WIDTH_16BIT;         // 16 位宽
    init_struct.number = ADC_LEN;                                     // 搬 ADC_LEN 次（现在是 4）
    init_struct.periph_inc = DMA_PERIPH_INCREASE_DISABLE;             // 外设地址固定
    init_struct.memory_inc = DMA_MEMORY_INCREASE_ENABLE;              // 内存地址递增
    init_struct.circular_mode = DMA_CIRCULAR_MODE_ENABLE;             // ★ 循环模式
    init_struct.priority = DMA_PRIORITY_LOW;

    dma_single_data_mode_init(DMA1, DMA_CH0, &init_struct);
    dma_channel_subperipheral_select(DMA1, DMA_CH0, DMA_SUBPERI0);    // ★ 通道映射查表
    dma_flag_clear(DMA1, DMA_CH0, DMA_FLAG_FTF);
    dma_channel_enable(DMA1, DMA_CH0);                                // 启动
}
```

**四个不能错的点**：

| 项 | 值 | 错了会怎样 |
| --- | --- | --- |
| `direction` | `PERIPH_TO_MEMORY` | 设错则数据反向，全是垃圾 |
| `periph_inc` / `memory_inc` | **外设不变 / 内存递增** | 外设递增会读到不存在的寄存器 |
| `circular_mode` | `ENABLE` | 关了就是"搬 3 次就停"（第 08 篇 P2M 的老问题） |
| `subperipheral_select(..., DMA_SUBPERI0)` | `DMA_SUBPERI0` | **选错子外设 = DMA 永远收不到请求**（第 08 篇重点讲过的"通道映射表"） |

**循环模式是本篇最舒服的一点**：DMA 自己不停地搬，`encodes[]` 里的三个值**永远是最新的**——
主循环**随时读、不用等、不用触发**。（第 19 篇的"每次转换完要触发一次"是手动版，这里是自动版。）

> **共享资源的坑（`整理操作参考.md` 已经点出）**：ADC 用的是 **`DMA1_CH0` + `SUBPERI0`**，
> 而第 08 篇的 DMA M2M 试验**也占 `DMA1_CH0`**。两者配置互斥，**不可能同时存在**——
> 这也是 `067922c` 顺手删掉 `DMA_m2m_config()` 的硬件理由。

### 4.3 ADC 配置

```c
static void msp_adc_config()
{
    // 引脚：PC4（电位器）与 PA1（NTC）都配成"模拟"模式
    rcu_periph_clock_enable(RCU_GPIOC);
    gpio_mode_set(GPIOC, GPIO_MODE_ANALOG, GPIO_PUPD_NONE, GPIO_PIN_4);
    rcu_periph_clock_enable(RCU_GPIOA);
    gpio_mode_set(GPIOA, GPIO_MODE_ANALOG, GPIO_PUPD_NONE, GPIO_PIN_1);

    adc_deinit();
    rcu_periph_clock_enable(RCU_ADC0);
    adc_clock_config(ADC_ADCCK_PCLK2_DIV4);              // ★ APB2/4 = 84/4 = 21 MHz
    adc_sync_mode_config(ADC_SYNC_MODE_INDEPENDENT);
    adc_special_function_config(ADC0, ADC_CONTINUOUS_MODE, ENABLE);   // 连续转换
    adc_special_function_config(ADC0, ADC_SCAN_MODE, ENABLE);         // 扫描（多通道）
    adc_special_function_config(ADC0, ADC_INSERTED_CHANNEL_AUTO, DISABLE);
    adc_resolution_config(ADC0, ADC_RESOLUTION_12B);
    adc_data_alignment_config(ADC0, ADC_DATAALIGN_RIGHT);
    adc_channel_length_config(ADC0, ADC_ROUTINE_CHANNEL, ADC_LEN);    // ★ 通道数 = ADC_LEN（现在是 4）
    adc_routine_channel_config(ADC0, 0, ADC_CHANNEL_14, ADC_SAMPLETIME_15);   // 电位器 PC4
    adc_routine_channel_config(ADC0, 1, ADC_CHANNEL_16, ADC_SAMPLETIME_480);  // 内部温度
    adc_routine_channel_config(ADC0, 2, ADC_CHANNEL_1, ADC_SAMPLETIME_15);    // NTC PA1
    adc_channel_16_to_18(ADC_TEMP_VREF_CHANNEL_SWITCH, ENABLE);      // 内部通道要单独开

    adc_dma_request_after_last_enable(ADC0);   // DMA 请求相关（见下方说明）
    adc_dma_mode_enable(ADC0);                 // 打开 ADC 的 DMA 请求

    adc_enable(ADC0);
    delay_1ms(1);                              // 内部校准需要等待
    adc_calibration_enable(ADC0);
    adc_software_trigger_enable(ADC0, ADC_ROUTINE_CHANNEL);   // 启动
}
```

**"扫描 + 连续 + 循环 DMA"三件套 = 完全自动的采集流水线**：

```
ADC 自动扫 通道14 → 通道16 → 通道1 → 通道14 → ...
        │        │        │
        └────────┴────────┴──► DMA 自动搬进 encodes[0..2]（循环覆盖）
```

主循环什么都不用做，读 `msp_adc_get(2)` 就是最新温度。

**两处需要留意的细节**：

1. **通道注释与代码不符**：注释把 `ADC_CHANNEL_14` 和 `ADC_CHANNEL_16` **都**标成"内部温度传感器 17.1us"，
   而 `ADC_CHANNEL_1`（NTC）**没有注释**。按引脚表实际是：**CH14 = 电位器、CH16 = 内部温度、CH1 = NTC**。
   —— 移植时如果照着注释改，很可能把 NTC 当成内部温度通道。**注释也会骗人**（第 23 篇的老话题）。
2. **`adc_dma_request_after_last_enable()` 的语义在库源码里是矛盾的**：
   函数名和 `ADC_CTL1_DDM`（DMA disable mode）的 enable/disable 两个版本的文档注释互相打架
   （一个说"每次常规转换结束都发请求"，另一个说"检测到 DMA 传输结束信号后关闭 DMA 引擎"）。
   **遇到这种"名字和注释对不上"的情况，唯一可靠的办法是实测**（换个通道数、看 `encodes[]` 会不会错位）。

### 4.4 NTC 侧换算

```c
int8_t bsp_ntc_get_tem(void)
{
    uint16_t adc_dat = 0;
    float vol = 0.0, r = 0.0;
    int8_t tem = 0;

    adc_dat = NTC_GET_ENCODE();          // = msp_adc_get(2)（第 3 个通道）
    vol = adc_dat * VREF / 4096;         // ① 数字 → 电压（VREF = 3.3）
    r = 10 * vol / (3.3 - vol);          // ② 电压 → 电阻（kΩ）
    tem = search_tem((uint16_t)(r * 100)); // ③ 电阻×100 → 查表得温度
    return tem;
}
```

`bsp_ntc.h` 里那个别名宏，是又一个"低成本适配"：

```c
#define NTC_GET_ENCODE() msp_adc_get(2)   // 通道号 2 = 序列里的第 3 个 = NTC(PA1)
```

> **为什么是 `msp_adc_get(2)` 而不是"通道 1"？**
> 这个 2 是 **序列里的序号**（`adc_routine_channel_config(ADC0, 2, ADC_CHANNEL_1, ...)` 的那个 2），
> 不是通道号。**两个编号体系混在一起是这个接口最容易踩的坑**——
> 一旦有人调换了序列顺序，NTC 就读到电位器的值（反之亦然）。**练习题 4 就是把这件事显式化。**

---

## 五、采样时间与精度的账

**ADC 时钟**：`ADC_ADCCK_PCLK2_DIV4`，APB2 = 84 MHz → **ADC 时钟 = 21 MHz**。

一次转换的耗时 = **采样时间 + 12 个转换周期**（12 位逐次逼近）：

| 序列 | 通道 | 采样周期 | 采样时间 | 一次转换总时间 |
| --- | --- | --- | --- | --- |
| 0 | CH14（电位器） | 15 | 15/21M = **0.714 µs** | 27/21M = **1.29 µs** |
| 1 | **CH16（内部温度）** | **480** | 480/21M = **22.86 µs** | 492/21M = **23.43 µs** |
| 2 | CH1（NTC） | 15 | 15/21M = **0.714 µs** | 27/21M = **1.29 µs** |
| 合计 | | | | **≈ 26 µs / 轮** |

**核对两件事**：

1. **内部温度通道必须 ≥ 17.1 µs 采样**（数据手册对温度传感器的最小采样时间要求）：
   `480` 周期 = **22.86 µs ≥ 17.1 µs ✅ 满足**。
   > 这正是第 19 篇留下的那个问题的**修复**：`d502d82` 曾把温度通道改成 `15` 周期（0.714 µs，**远不满足**），
   > 现在这一版把它改回了 `480`。**（当时笔记里标红的"不满足手册要求"，现在已被改好。）**
2. **外部通道（电位器 / NTC）用 15 周期（0.714 µs）是否够**：
   外部通道没有"17.1 µs"这种硬要求，但要求"**采样时间 ≥ 源阻抗 × 采样电容的充电时间常数**"。
   15 周期的下限对应**较低的源阻抗**。分压电路里上臂是 10 kΩ，
   **源阻抗偏低（几 kΩ 量级）**，15 周期属于"快但偏紧"的选择——
   如果读出来的值**跳得厉害**，第一件事就是把采样时间加大到 `ADC_SAMPLETIME_56` 或以上（第八章第 3 条）。

> **换算成"刷新率"**：一轮 26 µs → 一轮/26 µs ≈ **38 kHz**。
> 也就是说 `encodes[2]` 每 26 µs 就被更新一次，**远远快于任何温度变化的物理速度**。
> 所以**精度瓶颈完全不在采样速度，而在 NTC 表本身与分压电阻的精度**（典型 ±1~2 ℃）。

---

## 六、最终代码速查

| 接口 | 作用 | 参数 | 出处 |
| --- | --- | --- | --- |
| `msp_adc_init()` | DMA + ADC 一次配好并启动 | — | `Hardware/msp_adc/msp_adc.c` |
| `msp_adc_get(i)` | 取第 i 个序列的值（0~2） | `i`: 序列序号 | 同上 |
| `bsp_ntc_init()` | **空实现**（占位） | — | `Driver/bsp_ntc/bsp_ntc.c` |
| `bsp_ntc_get_tem()` | 取温度 | 返回 −55 ~ +125 | 同上 |
| `NTC_GET_ENCODE()` | 宏：取 NTC 的原始 ADC 码 | — | `Driver/bsp_ntc/bsp_ntc.h` |

**序列/通道对照（最该记住的一张表）**：

| 序列序号 | ADC 通道 | 引脚 | 是什么 | 采样周期 |
| --- | --- | --- | --- | --- |
| 0 | CH14 | PC4 | 电位器 | 15 |
| 1 | CH16 | 内部 | 芯片温度 | 480 |
| **2** | **CH1** | **PA1** | **NTC（本篇）** | 15 |
| 3 | CH8 | PB0 | **AD 按键（ADKEY，第 28 篇）** | 15 |

**关键常数**：`ADC_LEN`（**2026-10-12 起是 4**）、`VREF = 3.3`、分压上臂 `10 kΩ`、表长 `181`、表首 `-55 ℃`、表步进 `0.01 kΩ`。

> **📌 后续（2026-10-12）**：`0d729ce` 给 ADC 加了**第 4 个通道**（`ADC_CHANNEL_8` = **PB0**），
> 用来读 **AD 按键**（电阻分压的 3 个按键共用这根线，见 **[第 28 篇](28-AD按键ADKEY.md)**）。
> 所以现在 `ADC_LEN = 4`：
>
> | 序列 | 通道 | 引脚 | 用途 | 采样周期 |
> | --- | --- | --- | --- | --- |
> | 0 | CH14 | PC4 | 电位器 | 15 |
> | 1 | CH16 | 内部 | 芯片温度 | 480 |
> | **2** | **CH1** | **PA1** | **NTC（本篇）** | 15 |
> | 4→3 | CH8 | PB0 | **AD 按键（第 28 篇）** | 15 |
>
> **★ 这正好演示了第 28 篇那个 bug 的起源**：`msp_adc_get(3)` 里的 `3` 是**序列序号**，
> 与 `ADC_CHANNEL_8` 的"通道 8"**完全是两套编号**——一处改错就会读到别人的值。

---

## 七、遗留问题（3 个）

| # | 问题 | 位置 | 后果 / 修法 |
| --- | --- | --- | --- |
| 1 | **`3.3 - vol` 可能为 0** | `bsp_ntc_get_tem()` | NTC **开路**时 `vol → 3.3`，浮点除零得 `inf`，再 `(uint16_t)(inf)` 是**未定义行为**。修法：`if (vol > 3.29) vol = 3.29;` 或先判"越界就返回上一次的值/错误码" |
| 2 | **表没有 `const`** | `uint16_t temp_table[]` | 数组被**初始化过**的全局变量默认放在 **`.data`（RAM）**，而不是 flash——**362 字节白占 RAM**，与代码里"定义数组放到flash中"的注释**相反**。改成 `static const uint16_t temp_table[]` 才会进 flash 的 `.rodata` |
| 3 | **`bsp_ntc_init()` 是空函数** | `bsp_ntc.c` | 初始化责任全在 `msp_adc_init()`。留着空函数是**为了接口对称**（六个 `bsp_*_init()` 一字排开很好看），但**对读者是误导**——建议加注释说明"初始化在 msp_adc" |

**另外一个"设计层面"的观察**：

`bsp_ntc_get_tem()` 返回 `int8_t`（−128~127，够 −55~125），而 `bsp_188_leds_set_num()` 收 `uint8_t` 且只接受 `0~199`
（第 26 篇）。于是在 `main.c` 里：

```c
bsp_188_leds_set_num(bsp_ntc_get_tem());   // 负数会被隐式转成 255 附近的数 → 函数直接 return
```

**后果**：**温度低于 0 ℃ 时数码管不更新**（保留上一次的显示）——不是崩溃，是"沉默地不动"。
要显示负温，得先把 `get_tem()` 的结果做映射（例如 `tem < 0 ? 199 : tem`，或点亮 K1 当负号）。
**两个模块各自的接口都没错，错在中间没做"单位/值域对齐"**——这是多模块协作时最常见的缝隙。

---

## 八、排查清单

| # | 现象 | 最可能的原因 | 怎么验证 |
| --- | --- | --- | --- |
| 1 | 温度恒定在 **−55 ℃**（或读数顶格） | NTC **开路/没插** → 电压顶到 3.3 V | 万用表量 PA1 电压，正常应是 1~2 V 量级 |
| 2 | 温度恒定在 **125 ℃** | NTC **短路** → 电压 ≈ 0 | 同上 |
| 3 | 读数**跳得厉害** | 采样时间太短（15 周期）或分压电阻/走线干扰 | 把采样周期加大到 56/84，看是否变稳 |
| 4 | 温度**整体偏高/偏低**（差好几度） | ① 分压上臂不是 10 kΩ ② `VREF` 不是 3.3 V（USB 供电实测可能是 3.2~3.3）③ 用的是**别的型号** NTC（表不匹配） | 用已知温度（冰水/体温）标定一次 |
| 5 | 显示的数字**和串口打印的不一致** | `bsp_188_leds_set_num()` 收到负数/超 199 会直接 `return` | 见第七章的"值域对齐" |
| 6 | 一开 ADC 就 DMA 不搬（`encodes[]` 不动） | `dma_channel_subperipheral_select()` 的子外设号选错 | 第 08 篇"通道映射表"；ADC0 用 `DMA_SUBPERI0` |
| 7 | DMA 搬几次就停 | `circular_mode` 没开 | 检查 `DMA_CIRCULAR_MODE_ENABLE` |
| 8 | 编译报**重复符号** `msp_adc_get` | `main.c` 里的旧实现没删干净（`067922c` 前的老问题） | 全局搜索函数名 |

---

## 九、自测题

1. NTC 是"温度越高电阻越大"还是相反？这导致 ADC 读数与温度是**正相关**还是**反相关**？
2. 写出从 `V` 反推 `R` 的公式。若上臂电阻不是 10 kΩ，代码里哪一行要改？
3. 为什么本工程用**查表**而不是 B 值公式？用本篇的表数据说明"B 值不是常数"。
4. `temp_table[]` 为什么单位是"电阻 × 100"？不乘 100 会怎样？
5. `search_tem()` 里 `return index - 55` 的 55 是怎么来的？
6. ADC 时钟是多少？内部温度通道为什么要用 480 个采样周期？换成 15 会怎样？
7. `circular_mode = ENABLE` 给上层带来了什么好处？
8. `NTC_GET_ENCODE()` 里的 `2` 是通道号还是序列号？搞混会出什么错？
9. ADC 和 DMA M2M 试验为什么不能共存？
10. 为什么 `bsp_ntc_get_tem()` 返回负数时，188 数码管会"停住不动"？

### 练习题

1. **换一颗 NTC**：把表换成另一规格（例如 10 kΩ B=3435）的 R-T 表，说明要改哪几行、不改会有什么后果。
2. **换成二分查找**：把 `search_tem()` 改成二分（提示：温度升序 ⇒ 电阻降序，是**单调**的），并比较比较次数。
3. **加线性插值**：在最近邻的基础上，用相邻两点做插值，把分辨力从 1 ℃ 提到 0.1 ℃（返回类型也要改）。
4. **消除序号魔数**：给 `msp_adc_get()` 增加枚举（如 `ADC_SEQ_POT`、`ADC_SEQ_TEMP`、`ADC_SEQ_NTC`），让 `NTC_GET_ENCODE()` 不再依赖裸数字 2。
5. **修 3 个遗留**：给 `temp_table` 加 `static const`；给 `vol` 加饱和保护；给 `bsp_ntc_init()` 加说明注释（或干脆删掉它并在头文件注明）。
6. **做一次标定实验**：把 NTC 放进冰水（0 ℃）和沸水（≈100 ℃，注意器件耐温）各测一次，记录串口值与真实温度的偏差，判断误差主要来自表还是来自 `VREF`。

---

## 附：提交清单

| # | 提交 | 时间 | 分支 | 说明 | 改动 |
| --- | --- | --- | --- | --- | --- |
| 1 | `b80ce12` | 09-29 17:46 | main | [更新] ADC测试 芯片温度 | ADC 首次裸写在 `main.c`（第 19 篇） |
| 2 | `d502d82` | 09-30 10:19 | main | [更新] 多通道ADC 配置扫描模式和每个通道转换完成产生EOC | 加扫描模式 + 多通道 |
| 3 | `f8b4b85` | 09-30 15:00 | main | [更新] 多通道ADC 使用DMA搬运 | 加 DMA P2M（第 08 篇） |
| 4 | **`067922c`** | 10-10 20:08 | main | [整理] 整理main函数 | **`main.c` 453 → 264 行**：删除 `DMA_m2m_config` / `DMA1_Channel0_IRQHandler` / `msp_adc_dma_config` / `msp_adc_config` / `msp_adc_get` / `msp_fwdgt_config` / `msp_wwdgt_config` 及全局 `Time time` / `dat[1024]`；新增 `Doc/整理操作参考.md`（35 KB） |
| 5 | **`d961737`** | 10-10 20:19 | main | [更新] msp_adc bsp_ntc ADC NTC热敏电阻读取温度 封装 | 新建 `Hardware/msp_adc/`（`.c` 108 + `.h` 18）与 `Driver/bsp_ntc/`（`.c` 233 + `.h` 14）；`eide.yml` +4；`main.c` 改为 `msp_adc_init()` + `bsp_ntc_get_tem()` |

## 参考笔记

- `../../../NOTE/Note/ADC.md` —— ADC 整理版笔记（系统工作原理、采样时间与源阻抗、查询表）
- `../../../NOTE/Textbook/ADC/ADC开发🌟🌟🌟.mhtml` —— 教材主线（多通道 + DMA 的完整流程）
- `../../../NOTE/Textbook/ADC/ADC系统工作原理.mhtml` —— 逐次逼近、采样保持、通道与序列
- `../../../NOTE/Textbook/ADC/GD32F4之ADC查询.mhtml` —— **ADC 引脚/通道/采样时间查询表**（本篇 §5 的 17.1 µs 与 480 周期从这里来）
- 工程内文档：`Doc/整理操作参考.md`（§0 规范依据、§1 现状清单、§1.1 **符号冲突与 DMA 争用**）
- 相关篇目：[19 ADC](19-ADC.md)（本篇的上游：ADC 原理与前三笔提交）、[08 DMA](08-DMA.md)（通道映射与循环模式）、[26 188数码管](26-188数码管.md)（**温度的显示端，注意值域对齐**）、[13 专题·计时外设](13-专题-计时外设与频率计算.md)（采样时间/ADC 时钟的算法）、[23 查手册](23-专题-如何查手册与数据手册.md)（"采样时间怎么查"的案例）、[20 工程文档与硬件信息](20-工程文档与硬件信息.md)（引脚归属）

> 本笔记仅作学习整理，内容来自本仓库真实提交记录；§2 的 B 值反推与 §5 的采样时间均由本篇亲自验算，表数据取自 `bsp_ntc.c` 原文。
