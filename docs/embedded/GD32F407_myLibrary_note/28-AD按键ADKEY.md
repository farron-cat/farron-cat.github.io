# 28 · AD 按键（ADKEY：一个 ADC 管多个按键）· 学习笔记

> 这一篇讲 **4 次提交**：`0d729ce`（读 ADC 值 + 中值滤波，先把电压测出来）→ `d6e72db`（单击 / 长按状态机，三份复制粘贴）→ `a1b35d8`（**代码精简：三份收敛成一张参数表**）→ `d9cabb9`（加入双击事件）。
> 它解决的是一个非常实际的问题：**GPIO 不够时，怎么用一根 ADC 线接 3 个按键**。
> 同时也贡献了本项目**最严重的一个 bug**（数组越界，每毫秒写 4 次越界内存），而且它是**在"精简"那一步引入的**。
> 整理日期：2026-10-14　｜　提交范围：`0d729ce`、`d6e72db`、`a1b35d8`、`d9cabb9`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想用起来 | 第六章速查：`bsp_adkey_scan()` + 三个回调 |
| 按键乱触发 / 不灵敏 | 第八章前 3 条（**阈值 20 与消抖时间**） |
| 想搞懂"一根线怎么区分三个键" | 第一章（分压原理 + 门限） |
| 想学"状态机怎么写事件" | 第四章（7 状态机 + 4 个回调） |
| **想学一个反面教材** | **第七章：数组越界是怎么被"精简"引入、又被"加功能"放大的** |

## 知识点地图

```
AD 按键（本篇）
├── 一、原理：一根 ADC 线接多个按键          分压 + 门限判定 + 为什么能省引脚
├── 二、★ 为什么要"中值滤波"                 0d729ce 的滑窗去极值
├── 三、提交演进                             裸测电压 → 单击/长按 → 精简成表 → 双击
│     3.1 三份复制粘贴的问题                  3.2 ★ "精简"引入的越界 bug
├── 四、7 状态机逐状态解读                    IDLE→确认→按下→长按/等待双击→双击
├── 五、回调与 `util_weak`                    __weak 的用途与统一位置
├── 六、最终代码速查
├── 七、⚠️ 数组越界：一个必须看懂的 bug       根因、后果、修法
├── 八、排查清单
└── 九、自测题 + 练习题
```

## 学习目标

1. 说清"3 个按键共用 1 根 ADC"的原理，并会算各键对应的 ADC 码值与安全间隔。
2. 说出**中值滤波**为什么比"直接平均"或"取一次"更适合按键采样。
3. 能画出 7 状态机的完整迁移图，并解释"为什么单击要等到双击等待超时才回调"。
4. **能独立找出并修复第七章那个越界 bug，并说清它为什么在 `-Wall` 下不报警。**
5. 理解 `__weak` 回调在本工程中的角色（默认实现 = 打印，应用层可覆盖）。

---

## 一、原理：一根 ADC 线接多个按键

### 1.1 电路：电阻分压"梯子"

```
        +3.3V
          │
        [ R_up ]
          │
          ●──────────────► PB0（ADC0_IN8，本工程用 msp_adc_get(3)）
          │
   ┌──────┼──────┬──────┐
  [R1]   [R2]   [R3]   （都不按下时：无直流通路 → 电压 = 3.3 V）
   │      │      │
  SW1    SW2    SW3
   │      │      │
  GND    GND    GND
```

- **都不按** → ADC 读到接近满量程；
- **按 SW1** → 下臂变成 R1 → 分压得到一个**特定电压**；
- **按 SW2 / SW3** → 下臂是 R2 / R3 → 另两个**特定电压**。

**核心思想**：**用"不同的电阻组合"给每个按键分配一个"电压指纹"**，MCU 只要读一次 ADC，就知道按的是谁。
代价是：**不能同时按两个**（会得到第三个电压，或者落在某个键的窗口里）。

### 1.2 本工程的三个"指纹"

代码里写死了三个 ADC 码值（12 位，0~4095）：

```c
#define KEY1_PRESS_ENCODE 945
#define KEY2_PRESS_ENCODE 2043
#define KEY3_PRESS_ENCODE 3135
```

| 按键 | ADC 码 | 对应电压（$V = code \times 3.3 / 4096$） | 与邻居的间隔 |
| --- | --- | --- | --- |
| KEY1 | **945** | **0.761 V** | — |
| KEY2 | **2043** | **1.646 V** | 1098 |
| KEY3 | **3135** | **2.526 V** | 1092 |
| （都不按） | ≈4095 | 3.3 V | 960 |

**判定用"绝对差 < 20"**：

```c
if (abs(encode - key->press_encode) < 20)   // 认为这个键被按下
```

`20` 这个窗口对应电压 $\pm 20 \times 3.3/4096 \approx \pm 16\ \text{mV}$ —— **很紧**。

> **三个数的间隔都在 1000 码以上（约 0.8 V），而判定窗口只有 ±20 码**，
> 所以"误判成隔壁键"几乎不可能；**真正会出问题的是"读到的值根本不在任何一个窗口里"**
> （电阻误差、接触电阻、供电波动）→ 表现就是"按了没反应"（第八章第 1 条）。

### 1.3 为什么值得这么做

| | 3 个独立 GPIO 按键 | **1 个 ADC + 3 个电阻** |
| --- | --- | --- |
| 占用引脚 | 3 | **1** |
| 需要外部上拉 | 3 个（或内部上拉） | 0（内部有分压网络） |
| 同时按下 | 支持 | **不支持** |
| 成本 | 低 | 多 3 个电阻（或买现成模块） |
| 抗干扰 | 强（数字信号） | **弱**（模拟量，受电源纹波影响） |

**结论**：**引脚紧张 + 不需要同时按** 的场合才用（遥控器、小家电面板最常见）。
本工程用它是因为：**188 数码管 + 矩阵键盘 + 旋转编码器已经把 PE 口抢光了**（第 26/10/29 篇）。

---

## 二、为什么要"中值滤波"

第一次提交（`0d729ce`）**只做了一件事：把电压稳定地测出来**——用了一个 10 次采样的**滑窗，去掉最大值和最小值再平均**：

```c
// 0d729ce 的 bsp_adkey_scan()：中值滤波 + 打印电压
static uint8_t  sample_cnt = 0;
uint16_t sample_sum = 0, sample_max = 0, sample_min = 4095;

void bsp_adkey_scan(void)
{
    uint16_t encode = msp_adc_get(3);
    sample_sum += encode;
    if (encode > sample_max) sample_max = encode;
    if (encode < sample_min) sample_min = encode;

    if (++sample_cnt == 10)
    {
        sample_cnt = 0;
        encode = (sample_sum - sample_max - sample_min) / 8;   // 去掉一个最大、一个最小，除以 8
        float vol = encode * VREF / 4096;
        printf("vol:%f\n", vol);
        sample_sum = 0; sample_max = 0; sample_min = 4095;
    }
}
```

**三个值得说的点**：

| 点 | 说明 |
| --- | --- |
| **为什么去掉最大最小** | 模拟量最容易受**单次尖峰**影响（PWM 开关、别的 GPIO 翻转、电源纹波）。掐头去尾比"纯平均"更抗脉冲噪声——这就是**"中值+均值"的简化版** |
| **除以 8，不是 10** | 去掉 2 个样本后剩 **8** 个 ✓（**这个 8 是"10 减 2"算出来的，不是凑的**） |
| **数据来源** | `msp_adc_get(3)` —— 第 27 篇的 ADC 序列里**第 4 个通道**（`ADC_CHANNEL_8` = **PB0**），正是这一次提交给 `msp_adc` 加了第 4 通道 |

> **注意**：0d729ce 只在 `sample_cnt == 10` 时才更新一次输出，也就是**每 10 次扫描才产生一个有效值**。
> 而扫描放在 SysTick 的 1 ms 分支里 → **实际采样率 100 Hz**。
> 第二版状态机沿用了这个节奏，所以消抖时间用的是"`get_us_cnt()` 实际时间差"而不是"扫描次数"——**这是对的**（不依赖调用频率）。

---

## 三、提交演进

### 3.1 `d6e72db`：单击 + 长按，但写了三份

这一版把状态机写出来了，但**是给每个按键各写一份**：

```c
// d6e72db 的形态（示意）
static ADKEY_STATE key1_state = ADKEY_IDLE;
static ADKEY_STATE key2_state = ADKEY_IDLE;
static ADKEY_STATE key3_state = ADKEY_IDLE;

void bsp_adkey_scan(void)
{
    uint16_t encode = msp_adc_get(3);

    switch (key1_state) { ... }   // 约 70 行
    switch (key2_state) { ... }   // 约 70 行，和上面几乎一样，只换了 KEY1/KEY2
    switch (key3_state) { ... }   // 约 70 行，同上
}
```

**问题一眼可见**：**三份逻辑完全相同、只有"阈值常量"和"状态变量"不同的代码**。
这类代码的三个典型危害：

1. 改一个 bug 要改三处（**漏一处就变成"只有 KEY2 好使"这种诡异现象**）；
2. 加一个功能（比如双击）要写三遍；
3. 三份代码会**逐渐漂移**（某次只在一份里调了时间参数）。

### 3.2 `a1b35d8`：精简成"参数表 + 一个状态机"

这次提交把 3 份收敛成 1 份，并把变化的量提成数据：

```c
// ADKEY参数结构体（头文件）
typedef struct {
    uint8_t      id;            // 按键ID（回调里用）
    uint16_t     press_encode;  // 按下对应的ADC编码 ← 三个键唯一的差异
    ADKEY_STATE  state;         // 状态 ← 三个键各自的状态
    uint64_t     pre_time;      // 上一次时间
} ADKEY_PARAM;

static ADKEY_PARAM adkeys[] = {          // ← 参数表（本项目第 4 次用这张手法）
    {1, KEY1_PRESS_ENCODE, ADKEY_IDLE, 0},
    {2, KEY2_PRESS_ENCODE, ADKEY_IDLE, 0},
    {3, KEY3_PRESS_ENCODE, ADKEY_IDLE, 0},
};

static void scan_single_key(uint16_t encode, ADKEY_PARAM *key) { ...一个状态机... }

void bsp_adkey_scan(void)
{
    uint16_t encode = msp_adc_get(3);
    for (uint8_t i = 0; i < ADKEY_LENGTH; i++)      // ★★ 灾难在这一行
    {
        scan_single_key(encode, &adkeys[i]);
    }
}
```

**手法本身完全正确**（顺带把扫描挪进了 SysTick 的 1 ms 分支），
**但那个循环上界 `ADKEY_LENGTH` 是错的**——详见第七章（这是本篇的重点）。

> **本项目"参数表化"的四次复现**：`bsp_leds`（第 02 篇，`leds[]`）→ `bsp_188_leds`（第 26 篇，`pins[]`）→ `bsp_ec12d`?（第 29 篇没有表）→ **`bsp_adkey`（本篇，`adkeys[]`）**。
> **表化是对的，但"表长"必须用 `sizeof(表)/sizeof(表[0])` 算，不能用别的语义的长度**。

### 3.3 `d9cabb9`：加双击（以及把 bug 放大）

这次给状态机加了 3 个状态（等待双击 / 双击确认 / 双击），并新增两个回调：

```c
ADKEY_IDLE → ADKEY_PRESS_CONFORM → ADKEY_PRESS → ┬─ ADKEY_LONG_PRESS       （长按）
                                                 └─ ADKEY_DOUBLE_WAIT → ADKEY_DOUBLE_PRESS_CONFORM
                                                                      → ADKEY_DOUBLE_PRESS
```

**关键副作用**：状态枚举从 4 个变成 7 个 → `ADKEY_LENGTH` 从 **4 变成 7** →
`for (i = 0; i < ADKEY_LENGTH; i++)` 的**越界幅度从 1 个元素变成 4 个元素**。
**加功能把 bug 放大了 4 倍**——而这次提交**一行都没碰那个循环**（第八章第 5 条）。

---

## 四、7 状态机逐状态解读

### 4.1 时间参数（三个宏）

```c
#define ADKEY_PRESS_CONFORM_TIM 30000   // 消抖确认 30 ms
#define ADKEY_LONG_PRESS_TIM    500000  // 长按     500 ms
#define ADKEY_DOUBLE_WAIT_TIM   300000  // 等第二次按下 300 ms
```

**三个时间全部用微秒**，靠 `get_us_cnt()`（第 01 篇的 1 μs 时基）比较，
**不依赖"扫描了多少次"** —— 这一点很关键：扫描频率从 100 Hz 变成 1 kHz 都不用改参数。

### 4.2 状态迁移（完整版）

| 状态 | 转移条件 | 去向 | 动作 |
| --- | --- | --- | --- |
| **IDLE** | `\|Δ\| < 20`（进入窗口） | PRESS_CONFORM | 记 `pre_time` |
| **PRESS_CONFORM** | 30 ms 后**仍在**窗口 | PRESS | — |
| | 30 ms **内**出窗口 | IDLE | （判为抖动） |
| **PRESS** | 仍在窗口 **且** > 500 ms | LONG_PRESS | **`on_adkey_long_press()`** |
| | 在 500 ms **内**出窗口 | DOUBLE_WAIT | （等一下，看有没有第二次） |
| **LONG_PRESS** | 出窗口 | IDLE | （长按只报一次） |
| **DOUBLE_WAIT** | 300 ms 内**又**进窗口 | DOUBLE_PRESS_CONFORM | 记 `pre_time` |
| | 300 ms 后**仍**不在窗口 | IDLE | ★ **`on_adkey_click()`（单击在这里才报）** |
| **DOUBLE_PRESS_CONFORM** | 30 ms 后仍在窗口 | DOUBLE_PRESS | — |
| | 30 ms 内出窗口 | IDLE | （判为抖动） |
| **DOUBLE_PRESS** | 500 ms 内出窗口 | IDLE | ★ **`on_adkey_double_click()`** |
| | > 500 ms 仍在窗口 | LONG_PRESS | ★ **`on_adkey_click_long_press()`** |

`|Δ|` 即 `abs(encode - key->press_encode)`。

### 4.3 三个设计上的巧思（以及一处瑕疵）

**① 单击"迟到"是故意的**：按下 → 松开后**不立刻报单击**，而是进 `DOUBLE_WAIT` 等 300 ms；
等不到第二次才报 `on_adkey_click()`。
**这是"单击/双击不能同时立刻确认"的本质**：**双击的代价就是单击要延迟一个等待窗口**（300 ms 是取舍点）。

**② 长按"只报一次"**：进 `LONG_PRESS` 后不再重复回调，直到松开才回 IDLE。
否则按住不动会每秒报几十次（这类"连发"如果不需要，就不要做）。

**③ "单击+长按"组合**：`DOUBLE_PRESS` 下继续按住 500 ms 会报 `on_adkey_click_long_press()`
——即"单击一次后按住不放"这个动作。**这是三个动作（单击/双击/长按）之外的第四个事件**，
在遥控器类产品里常用来进"设置模式"。

**④ 瑕疵：`ADKEY_PRESS` 里用的是两个 `if` 而不是 `if/else if`**

```c
case ADKEY_PRESS:
    if ((abs(encode - key->press_encode) < 20) && ((get_us_cnt() - key->pre_time) > ADKEY_LONG_PRESS_TIM))
    { ... }                       // 长按
    if ((abs(encode - key->press_encode) >= 20) && ((get_us_cnt() - key->pre_time) <= ADKEY_LONG_PRESS_TIM))
    { ... }                       // 松开（短按）
```

**这次没问题**（两个条件互斥：一个要求"在窗口内"，一个要求"在窗口外"，不可能同时成立）。
但**写成 `else if` 更安全**——将来若有人把两个条件改成不互斥（比如都判"在窗口内"），
**两个分支会同时执行**，而这类 bug 极难发现。

### 4.4 回调（`__weak` + 应用层覆盖）

```c
__weak void on_adkey_click(uint8_t id)             { printf("KEY%d_CLICK\n", (int)id); }
__weak void on_adkey_long_press(uint8_t id)        { printf("KEY%d_LONG_PRESS\n", (int)id); }
__weak void on_adkey_double_click(uint8_t id)      { printf("KEY%d_DOUBLE_CLICK\n", (int)id); }
__weak void on_adkey_click_long_press(uint8_t id)  { printf("KEY%d_CLICK_LONG_PRESS\n", (int)id); }
```

**`__weak` 的意义**：驱动层给一个**能跑的默认实现**（打印），
应用层只要**定义一个同名函数**就自动覆盖（第 03 篇 `bsp_keys` 的同一套路）。

**一个不一致**：头文件里只声明了 `on_adkey_click` / `on_adkey_long_press` 两个 `extern`，
**`on_adkey_double_click` / `on_adkey_click_long_press` 没有声明**（第八章第 6 条）。

> **`__weak` 现在有了统一的家**：`User/util_weak.h`（`ce1d68e` 整理出来的）
>
> ```c
> #ifndef __weak
> #define __weak __attribute__((weak)) // GCC / armclang
> #endif
> ```
>
> 在这之前，`bsp_keys.c` / `bsp_pcf8563.c` / `msp_rtc.c` / `bsp_adkey.c` / `bsp_ec12d.c` / `msp_uart.c`
> **各自抄了一份**（6 份重复定义）。这次把它们全部换成 `#include "util_weak.h"`——
> **典型的"同一个东西出现第 3 次就该提出来"**（第 01 篇的 `bsp_leds/keys` 重构是同一逻辑）。

---

## 五、最终代码速查

| 接口 | 作用 | 备注 |
| --- | --- | --- |
| `bsp_adkey_init()` | **空实现**（占位） | 初始化在 `msp_adc_init()`，注释里写明了 |
| `bsp_adkey_scan()` | 扫一次（读 ADC + 跑 3 个状态机） | **由 `SysTick_Handler` 每 1 ms 调用** |
| `on_adkey_click(id)` | 单击回调（`id` = 1/2/3） | `__weak`，应用层可覆盖 |
| `on_adkey_long_press(id)` | 长按回调 | 同上 |
| `on_adkey_double_click(id)` | 双击回调 | 同上（**头文件未声明**） |
| `on_adkey_click_long_press(id)` | 单击+长按回调 | 同上（**头文件未声明**） |

**数据通路**：

```
ADC0 序列 3 → msp_adc_get(3) → scan_single_key() → 状态机 → __weak 回调
   (PB0)        (静态数组读)      (阈值 20)        (7 状态)      (printf / 应用逻辑)
```

**关键常数**：阈值 `±20`、消抖 `30 ms`、长按 `500 ms`、双击窗口 `300 ms`、
三个码值 `945 / 2043 / 3135`、ADC 通道序号 `3`（= `ADC_CHANNEL_8` = **PB0**）。

---

## 六、⚠️ 数组越界：一个必须看懂的 bug

### 6.1 现场

```c
// 头文件
typedef enum {
    ADKEY_IDLE = 0, ADKEY_PRESS_CONFORM, ADKEY_PRESS,
    ADKEY_LONG_PRESS, ADKEY_DOUBLE_WAIT,
    ADKEY_DOUBLE_PRESS_CONFORM, ADKEY_DOUBLE_PRESS,
    ADKEY_LENGTH                        // ← 值是 7（状态个数）
} ADKEY_STATE;

// 源文件
static ADKEY_PARAM adkeys[] = {         // ← 只有 3 个元素！
    {1, KEY1_PRESS_ENCODE, ADKEY_IDLE, 0},
    {2, KEY2_PRESS_ENCODE, ADKEY_IDLE, 0},
    {3, KEY3_PRESS_ENCODE, ADKEY_IDLE, 0},
};

void bsp_adkey_scan(void)
{
    uint16_t encode = msp_adc_get(3);
    for (uint8_t i = 0; i < ADKEY_LENGTH; i++)      // ← 循环 0..6，但数组只有 0..2
    {
        scan_single_key(encode, &adkeys[i]);        // ← adkeys[3]~adkeys[6] 越界！
    }
}
```

**`ADKEY_LENGTH` 是"状态枚举的个数"，却被当成了"按键数组的长度"用。**

### 6.2 越界有多严重（自己算一遍）

`ADKEY_PARAM` 的大小（按 Cortex-M4 的 ABI 对齐）：

```c
uint8_t      id;            // offset 0，占 1，后面补 1 字节
uint16_t     press_encode;  // offset 2，占 2
ADKEY_STATE  state;         // offset 4，占 4（枚举 = int）
uint64_t     pre_time;      // offset 8，占 8
                            // 合计 16 字节
```

| 项 | 值 |
| --- | --- |
| 数组真实大小 | 3 × 16 = **48 字节** |
| 循环访问范围 | 7 × 16 = **112 字节** |
| **越界写入** | **64 字节**（`adkeys[3]`~`adkeys[6]`） |
| 发生频率 | **每 1 ms 一次**（在 SysTick 里），即 **每秒 1000 次** |

更要命的是状态机的 `default` 分支：

```c
default:
    key->state = ADKEY_IDLE;   // ← 对"越界后的垃圾内存"**无条件写入**
    break;
```

`adkeys[3..6]` 里的 `state` 字段是**内存里的随机值** → 大概率落到 `default` → **每次扫描都往越界地址写一次**。
`adkeys[]` 是 `static`，它后面紧跟的就是**同一个编译单元或相邻静态变量的数据**——
所以这个 bug 的表现是"**别的全局变量莫名其妙被改成 0**"（第 27 篇的 `encodes[]`、第 09 篇的 `displayBuffer[]` 都在附近）。

**这类 bug 的可怕之处**：它不会立刻崩，而是**让完全不相关的模块行为异常**——
你会去查显示、查 ADC、查串口，**唯独想不到是"按键模块在偷偷改它们的内存"**。

### 6.3 为什么 `-Wall` 不会报警

| 编译器能查的 | 这个 bug 为什么躲过去 |
| --- | --- |
| 数组下标是**编译期常量**且越界 | 这里是**变量 `i`**，编译期不知道值 |
| `for (i = 0; i < sizeof(a); i++)` 这类**明显**的越界 | `ADKEY_LENGTH` 是**另一个枚举**，编译器不认为它与数组有关 |
| GCC `-Warray-bounds`（需优化 + 常量推导） | 跨"枚举"和"数组"的语义关联，**编译器没有这个知识** |

**换句话说：没有任何编译器选项能可靠地抓住"用错长度"**。防它只能靠**写法规避**。

### 6.4 正确写法（三选一，推荐第 1 个）

```c
// ① 用"数组自己的长度"（最稳，改数组不用改循环）
#define ARRAY_LEN(a) (sizeof(a) / sizeof((a)[0]))
for (uint8_t i = 0; i < ARRAY_LEN(adkeys); i++)

// ② 把"按键个数"单独定义一个宏（与状态枚举彻底脱钩）
#define ADKEY_NUM 3
for (uint8_t i = 0; i < ADKEY_NUM; i++)

// ③ 让状态枚举末尾改名叫 ADKEY_STATE_LEN 并加注释"只用于状态计数，不要当数组长度"
```

### 6.5 这个 bug 的"教益"（比修法更重要）

| 阶段 | 发生了什么 | 教训 |
| --- | --- | --- |
| `d6e72db` | 三份复制粘贴，**没有 bug**（每个键一个变量，不存在"长度"概念） | 重复代码**不容易错**，但**改不动** |
| `a1b35d8` | "精简"成数组 + 循环，**引入越界 1 个元素** | ★ **重构本身会引入新 bug**；"精简"不是纯收益 |
| `d9cabb9` | 加 3 个状态 → `ADKEY_LENGTH` 4→7，**越界扩大到 4 个元素**，且没碰循环 | ★ **"长度"这种跨语义的耦合，会随着功能增加悄悄恶化** |

> **一句话总结**：**同一个 `ADKEY_LENGTH` 承担了两种语义**——
> "状态有几个"（枚举用）和"按键有几个"（数组用）。
> **一个符号只该有一个含义**；一旦它同时回答两个问题，**两个问题就会开始互相拖累**。
> （对照第 26 篇：`LED188_PIN_NUM` 只表示"引脚个数"，所以 `for (i < LED188_PIN_NUM)` 是对的 ✓）

---

## 七、排查清单

| # | 现象 | 最可能的原因 | 怎么验证 |
| --- | --- | --- | --- |
| 1 | **某个键怎么按都没反应** | 实际 ADC 值没落进 `±20` 窗口（电阻误差/供电波动） | 把 `printf` 打开看实际码值，与 `945/2043/3135` 对比 |
| 2 | 按键太"钝"（要按很重/很久） | 窗口太窄（`20`），或消抖 30 ms 偏长 | 把窗口放宽到 50~80，再试 |
| 3 | 一个键触发**别的键** | 窗口太宽（跨过了两个键之间的间隔） | 三个间隔都 >1000，安全；检查是否把 `press_encode` 写错 |
| 4 | 单击经常被识别成"没反应"，但双击正常 | 单击要等 300 ms 才回调 → **不是 bug，是设计** | 若想快点可用"松开即报单击 + 双击再补报"的方案 |
| 5 | **显示/LED/其它模块行为莫名其妙** | ★ **第七章的数组越界在改别人的内存** | 把循环上界改成 `sizeof(adkeys)/sizeof(adkeys[0])`，看现象是否消失 |
| 6 | 应用层定义的 `on_adkey_double_click()` 不生效 | 头文件里没有它的 `extern` 声明 | 补声明（或确认函数名/签名一致） |
| 7 | 电压读数一直在抖 | 没做中值滤波（0d729ce 那套），或 ADC 采样时间太短 | 见第 27 篇 §5：把采样周期加大 |
| 8 | 长按一直重复触发 | 在 `LONG_PRESS` 里又加了回调 | 本工程只在"进入长按"时报一次 ✓ |

---

## 八、自测题

1. 3 个按键共用 1 根 ADC 线，为什么"不能同时按"？同时按会发生什么？
2. `abs(encode - press_encode) < 20` 的 20 换成 200 会怎样？换成 5 呢？
3. 中值滤波里为什么"去掉最大值和最小值"后除以 **8** 而不是 10？
4. 单击为什么要等到双击等待窗口（300 ms）结束才回调？有没有办法让它更快？
5. 画出 7 状态机的完整迁移图（含每条边的时间和判据）。
6. `__weak` 回调的默认实现是什么？应用层怎么覆盖它？
7. **`for (i = 0; i < ADKEY_LENGTH; i++)` 错在哪？为什么编译器不报警？正确写法是什么？**
8. 为什么 `d9cabb9`（加双击）会让第七章那个 bug 变严重 4 倍？

### 练习题

1. **修 bug**：用 `ARRAY_LEN` 宏修掉越界，并给 `adkeys[]` 加编译期断言（`_Static_assert`）保证表长与 `ADKEY_NUM` 一致。
2. **加第 4 个键**：假设分压网络再加一档，写出你要改哪几行（提示：只该改"参数表 + 数量宏"，不该碰状态机）。
3. **改单击响应速度**：实现"松开后立刻报单击，若 300 ms 内又按下则撤回单击改报双击"（提示：需要一个"已报单击"标志）。
4. **加连发**：长按 500 ms 后每 100 ms 报一次 `on_adkey_long_repeat()`，说清怎么用状态机表达"每隔一段时间"（参考第 05 篇的时间片）。
5. **从越界里找证据**：在 `adkeys[]` 后面故意加一个 `volatile uint32_t canary = 0x5A5A5A5A;`，跑起来看它会不会被改（**这是排查越界最直接的手段**），验证修好之后它保持不变。
6. **算一遍分压**：给定 $R_{up}=10\ \text{k}\Omega$ 与三个下臂电阻，算出三档电压，验证它们与 `945/2043/3135` 是否吻合（不吻合就去核对原理图）。

---

## 附：提交清单

| # | 提交 | 时间 | 分支 | 说明 | 改动 |
| --- | --- | --- | --- | --- | --- |
| 1 | `0d729ce` | 10-12 12:13 | main | [更新] `bsp_adkey` ADKEY 封装 | 新建 `Driver/bsp_adkey/`（`.c` 39 + `.h` 10）；**只读 ADC + 10 次滑窗去极值 + printf 电压**；`msp_adc` 加第 4 通道（`ADC_CHANNEL_8` = PB0，`ADC_LEN` 3→4）；`gd32f4xx_it.c` 起 SysTick 1 ms 分支调用；`eide.yml` +2 |
| 2 | `d6e72db` | 10-12 15:46 | main | [更新] `bsp_adkey` 按键扫描 单击和长按 封装 | `.c` +212：**三份复制粘贴的状态机**（`key1/2/3_state`）；引入三个时间宏与 `get_us_cnt()` 判时；回调默认 printf |
| 3 | `a1b35d8` | 10-12 18:04 | main | [优化] `bsp_adkey` 代码精简 封装 | `.c` **-188**：三份收敛成 `adkeys[]` 参数表 + `scan_single_key()`；**★ 引入 `for (i < ADKEY_LENGTH)` 越界**；头文件加 `ADKEY_PARAM` 与状态枚举；扫描移入 SysTick |
| 4 | `d9cabb9` | 10-12 20:37 | main | [更新] `bsp_adkey` 添加双击事件到状态机 | `.c` +99：加 `DOUBLE_WAIT` / `DOUBLE_PRESS_CONFORM` / `DOUBLE_PRESS` 三状态；加 `on_adkey_double_click()` / `on_adkey_click_long_press()` 回调；**★ 状态数 4→7 使越界幅度放大到 4 个元素** |

## 参考笔记

- `../../../NOTE/Textbook/ADC/ADC开发🌟🌟🌟.mhtml` / `ADC系统工作原理.mhtml` —— ADC 采样与多通道（本篇第一章的电路基础）
- `../../../NOTE/Textbook/GPIO/GPIO输入🌟.mhtml` —— 独立按键的常规做法（与本篇的"AD 按键"对照：省引脚 vs 抗干扰）
- 相关篇目：[27 NTC 测温](27-NTC热敏电阻测温.md)（**同一个 `msp_adc` 的第 3 通道是 NTC、第 4 通道才是 ADKEY**）、[19 ADC](19-ADC.md)（序列与通道）、[03 独立按键](03-独立按键.md)（`bsp_keys` 的事件枚举与 `__weak` 回调，本篇是它的"模拟量版本"）、[26 188 数码管](26-188数码管.md)（抢引脚才逼出 AD 按键这个方案）、[01 工程搭建](01-工程搭建.md)（`get_us_cnt()` 时基与 `util_weak.h`）

> 本笔记仅作学习整理，内容来自本仓库真实提交记录；§1.2 的电压换算、§6.2 的结构体大小与越界字节数、§6.3 的编译器能力边界均由本篇验算/核实。
