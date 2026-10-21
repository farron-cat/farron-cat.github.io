# 16 · SPI 总线（软件实现 + 硬件实现）· 学习笔记

> 这一篇讲 **4 次提交**：`5ce9c77`（软件 SPI 封装）→ `b32b17a`（硬件 SPI 封装）→ `5334620`（软硬合并）→ `18cec36`（为 SPI Flash 补一个真正的全双工接口 `msp_spi_read_write_byte()`）。
> 主要使用者是 **SPI OLED（第 18 篇）** 和 **GD25Q32 SPI Flash（第 24 篇）**。
> 整理日期：2026-10-07（初版 10-06）　｜　提交范围：`5ce9c77`、`b32b17a`、`5334620`、`18cec36`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想知道怎么用 | 第六章速查表 + `msp_spi_write_byte()` / `msp_spi_read_byte()` / `msp_spi_read_write_byte()` |
| 屏幕上显示乱码/花屏 | 第九章排查清单前 5 条（**十有八九是 CPOL/CPHA 不对**） |
| 想搞懂 SPI 时序 | 第三章（CPOL 与 CPHA）——**这是本篇的核心** |
| 想搞懂"软硬两版怎么合并" | 第五章类比第 15 篇的同款套路（开关宏 + 三段结构） |
| 准备面试 | 四线/三线、四种模式、SPI 与 I2C 的取舍 |

## 知识点地图

```
SPI 总线
├── 硬件             PA5=SCK、PA7=MOSI、PA6=MISO（AF5）；SPI0 在 APB2
├── 与 I2C 的根本区别 4 线全双工、无地址、无应答；有独立收发线 → 不用切方向
├── 从机选择         NSS 用软件控制（SPI_NSS_SOFT），实际 CS 由器件驱动自己拉
├── 四种模式         CPOL（空闲电平）× CPHA（第几个边沿采样）= Mode 0~3
├── 时钟频率         SPI0 在 APB2 84 MHz ÷ 4 = 21 MHz（PSC=4）
├── 软件实现         GPIO 手动翻转；数据在 SCL 低时变化、上升沿被采样
├── 硬件实现         配 6 个参数 + TBE/RBNE 两个标志位推进；全双工要"发一个读一个"
├── 双实现共存问题    msp_spi.c 内联版与 msp_spi_hard.c 独立版并存，且 CPOL/CPHA 不一致 ⚠️
├── 软硬合并         SPI_HARD_SOFT_SWITCH 宏 + 三段结构（同第 15 篇 IIC 的做法）
└── 上层适配         bsp_spi_oled.h 用宏把 OLED 的读写映射到 msp_spi_*
```

## 学习目标

- 说出 SPI 与 I2C 在"线数、寻址、应答、速率、引脚方向"上的五条区别
- 看懂 CPOL/CPHA 四种模式，知道"为什么要和从机手册对齐"
- 掌握软件 SPI 的实现，理解"为什么软件 SPI 不用切引脚方向而软件 I2C 必须切"
- 掌握硬件 SPI 的六参数配置与两个标志位
- 会算 SPI 时钟频率（APB2 ÷ 分频）
- 认识"同一功能两版实现"的工程问题：**文件级双实现 vs 宏开关双实现**

---

## 一、SPI 是什么：四根线，点对点

```
   MCU（主机）                       从机（如 OLED / Flash）
   ┌─────────┐                      ┌──────────────┐
   │   SCK  ─┼───── 时钟 ───────────│ SCK          │
   │  MOSI  ─┼───── 主发从收 ───────│ SDA / SI     │
   │  MISO  ─┼───── 从发主收 ───────│ SDO / SO     │
   │    CS  ─┼───── 片选（低有效）───│ CS / SS      │   ← 每个从机一根
   └─────────┘                      └──────────────┘
```

| 信号 | 本工程引脚 | 方向 | 说明 |
| --- | --- | --- | --- |
| **SCK / SCL** | **PA5** | 主机→从机 | 时钟，主机产生 |
| **MOSI** | **PA7** | 主机→从机 | Master Out Slave In |
| **MISO** | **PA6** | 从机→主机 | Master In Slave Out（**本工程 OLED 用不到**） |
| **CS** | 由器件驱动控制 | 主机→从机 | 片选，低电平选中 |

> **注意 SPI 的引脚命名**：同一个引脚在不同资料里可能叫 `SDA`/`SI`/`DIN`/`MOSI`——**看器件手册时以功能为准，不要被名字绕晕**。本工程的 OLED 头文件里就直接注释了 `SCL=SCLK / SDA=MOSI`。

### 1.1 和 I2C 的五条根本区别

| | **I2C**（第 15 篇） | **SPI**（本篇） |
| --- | --- | --- |
| 线数 | **2**（SCL + SDA） | **4**（SCK + MOSI + MISO + CS） |
| 寻址 | **靠 7 位地址**同总线区分设备 | **靠 CS 片选**，一条总线只接一个从机（或每个从机一根 CS） |
| 应答 | **有 ACK/NACK** | **没有**，主机无法知道从机是否收到 |
| 速率 | 100 k / 400 kHz（受上拉+电容限制） | **可达几十 MHz**（推挽驱动，边沿陡） |
| 引脚方向 | SDA 双向，**要切输入/输出** | 收发**各有专线**，**不用切方向** |
| 电气 | **必须开漏 + 上拉** | 推挽即可（所以快） |

**一句话选型**：

```
需要"多设备共线、省引脚、能知道有没有人在" → I2C
需要"高带宽、数据流（屏幕/Flash）"          → SPI
```

### 1.2 本工程的 SPI 参数

| 项 | 值 | 说明 |
| --- | --- | --- |
| 外设 | **SPI0** | 挂在 **APB2**（84 MHz） |
| 复用 | `GPIO_AF_5` | PA5/PA6/PA7 都是 AF5 |
| 分频 | `SPI_PSC_4` | **SCK = 84 MHz / 4 = 21 MHz** |
| NSS | `SPI_NSS_SOFT` | 片选由软件（GPIO）控制，不用硬件 NSS |
| 数据帧 | 8 位，**高位在前**（`SPI_ENDIAN_MSB`） | 和 SPI Flash/屏幕的通用约定一致 |
| 传输模式 | `SPI_TRANSMODE_FULLDUPLEX` | 全双工（发的同时也在收） |

> **算频率**（联动第 14 篇）：SPI0 在 `RCU_APB2EN` → 时钟 84 MHz；`SPI_PSC_4` 表示四分频 → **21 MHz**。
> **这就是"查总线 → 算分频"这套方法在 SPI 上的又一次应用**——和串口波特率、定时器 PSC 是同一套思路。

---

## 二、一次通信的流程

```
① 主机拉低 CS（选中从机）
② 主机产生 8 个时钟脉冲（SCK）
   └─ 每个脉冲期间，MOSI 上给出一位，MISO 上收一位
③ 重复 ② 直到传完所有字节
④ 主机拉高 CS（结束）
```

**和 I2C 的对比**：

| | I2C | SPI |
| --- | --- | --- |
| 开始/结束 | 起始信号 / 停止信号（**时序组合**） | **CS 拉低 / 拉高**（一根线搞定） |
| 数据方向 | 一个字节里方向固定，切换要重新起始 | **每个时钟同时收发**（全双工） |
| 应答 | 每个字节后有一个 ACK 位 | **没有** |

**"没有应答"是 SPI 最大的软肋**：主机发了 100 个字节，从机一个都没收到，主机也不知道。**所以 SPI 器件通常要靠"读回寄存器/读状态"来确认**（比如 OLED 读 FS0 引脚判断芯片 ID、Flash 读 ID）。

这也解释了第 18 篇 SPI OLED 里那个看起来奇怪的函数：

```c
void bsp_spi_oled_get_data_form_ROM(uint8_t addrHigh, uint8_t addrMid, uint8_t addrLow, uint8_t *pbuff, uint8_t DataLen);
```

—— 它不是"从屏幕读显存"，而是**通过 MISO 去读板上那颗挂在同一组 SPI 线上的字库芯片/Flash**（头文件里叫 `FS0` / `CS2`）。

---

## 三、CPOL 与 CPHA：SPI 最容易出错的地方

**问题**：SCK 空闲时是高还是低？数据在时钟的哪一边沿被采样？这两个问题构成了 4 种模式。

| 参数 | 含义 |
| --- | --- |
| **CPOL**（Clock Polarity） | 时钟**空闲**电平：0 = 空闲低，1 = 空闲高 |
| **CPHA**（Clock Phase） | 数据在第几个边沿被采样：0 = 第一个边沿，1 = 第二个边沿 |

| 模式 | CPOL | CPHA | 空闲电平 | 采样边沿 | GD32 宏（常见写法） |
| --- | --- | --- | --- | --- | --- |
| **Mode 0** | 0 | 0 | 低 | **上升沿**采样 | `SPI_CK_PL_LOW_PH_1EDGE` |
| Mode 1 | 0 | 1 | 低 | 下降沿采样 | `SPI_CK_PL_LOW_PH_2EDGE` |
| Mode 2 | 1 | 0 | 高 | 下降沿采样 | `SPI_CK_PL_HIGH_PH_1EDGE` |
| **Mode 3** | 1 | 1 | 高 | **上升沿**采样 | `SPI_CK_PL_HIGH_PH_2EDGE` |

**记忆法**：

```
PH=0（第 1 个边沿采样）→ 数据必须在时钟"跳出来之前"就摆好 → 所以数据在"空闲电平期间"变化
PH=1（第 2 个边沿采样）→ 数据在"第 1 个边沿"变化 → 稍微晚一点
```

**为什么它是第一大坑？** 因为：

```
模式不匹配 → 从机采样到的位错位（整体偏移半拍或一位）
           → 屏幕上显示乱码/花屏，或者读回的 ID 完全不对
而"时钟有、数据有"，看起来一切正常 → 最难查
```

**⚠️ 本工程在这里真的踩了坑（代码里能看出来）**：

| 文件 | 配置的模式 | 说明 |
| --- | --- | --- |
| `Hardware/msp_spi/msp_spi.c`（内联硬实现，宏开关打开时生效） | `SPI_CK_PL_HIGH_PH_2EDGE` | **Mode 3** |
| `Hardware/msp_spi/msp_spi_hard.c`（独立文件，历史遗留） | `SPI_CK_PL_LOW_PH_1EDGE` | **Mode 0** |

**同一个工程里两份"硬件 SPI 实现"配了不同的模式**——这正是"合并之后没收尾"的典型症状（见第五章）。

**唯一正确的做法**：**打开从机（屏幕/Flash）的数据手册，找到 "SPI Mode" 那一行，照着配**。**不要靠猜，也不要"抄一份能跑的代码"。**

**软件实现对应哪种模式？** 看代码：

```c
static void msp_spi_soft_write_byte(uint8_t byte)
{
    for (uint8_t i = 0; i < 8; i++)
    {
        SPI_SCL_L;                    // 时钟拉低
        if (byte & 0x80) SPI_MOSI_H;  // 在"时钟低"期间摆数据
        else             SPI_MOSI_L;
        SPI_SCL_H;                    // 拉高 → 从机在这一刻采样
        byte <<= 1;                   // 高位先发
    }
}
```

**时序是**：时钟低 → 改数据 → 时钟高（采样）→ 时钟低……

```
数据在时钟低电平期间变化，在上升沿被采样
⇒ 等效于「空闲低 + 第一个边沿采样」= Mode 0
  （循环结束时 SCL 停在高，所以"字节间隙"看起来是空闲高；
   判断模式要以"数据变化/采样发生在哪个边沿"为准，不要只看最后的电平）
```

> **这就是软硬实现对不上的根源**：软件实现天然落在某个模式上，**硬件实现必须手动配成同一个模式**，两者才能互换。**这也是为什么"合并软硬实现"必须配一个可靠的对照实验（第 11 篇练习题 5 就是这么做的）。**

---

## 四、提交 `5ce9c77` + `b32b17a` + `5334620`：从软件到硬件再到合并

### 4.1 软件实现（`5ce9c77`）

```c
// 写入1个byte
static void msp_spi_soft_write_byte(uint8_t byte)
{
    // 0x55  0b01 010100
    for (uint8_t i = 0; i < 8; i++)
    {
        // SCL拉低  写入数据
        SPI_SCL_L;
        if (byte & 0x80) // 0b1000 0000
            SPI_MOSI_H;
        else
            SPI_MOSI_L;
        // 拉高 等待对方读取
        SPI_SCL_H;
        byte <<= 1;      // ← 左移一位，下次取次高位
    }
}

// 读取1个byte
static uint8_t msp_spi_soft_read_byte(void)
{
    uint8_t i, read = 0;
    for (i = 0; i < 8; i++)
    {
        SPI_SCL_L;
        read <<= 1;             // ← 把已收到的位左移，给新位腾位置
        if (SPI_MISO_READ)
        {
            read++;             // ← 读到高电平就 +1（相当于置最低位）
        }
        SPI_SCL_H;
    }
    return read;
}
```

**两个"位操作"小技巧值得记住**：

| 技巧 | 作用 |
| --- | --- |
| 发送用 `byte & 0x80` + `byte <<= 1` | **不用下标、不用移位运算**，每次只看最高位，然后整体左移 |
| 接收用 `read <<= 1` + `read++` | 先腾位、再填位，天然实现"高位先收" |

**注意软件 SPI 没有 `IIC_DELAY` 那样的延时**——因为推挽输出的边沿很陡，**只要从机允许的时钟频率足够，翻得越快越好**。这与 I2C（开漏+上拉，必须慢慢来）形成鲜明对比。

**初始化里的一个小细节**：

```c
static void msp_spi_soft_init(void)
{
    // SCL
    rcu_periph_clock_enable(SPI_SCL_RCU);
    gpio_bit_set(SPI_SCL_PORT, SPI_SCL_PIN);      // ← 先写输出锁存器，再配模式
    gpio_mode_set(SPI_SCL_PORT, GPIO_MODE_OUTPUT, GPIO_PUPD_NONE, SPI_SCL_PIN);
    gpio_output_options_set(SPI_SCL_PORT, GPIO_OTYPE_PP, GPIO_OSPEED_MAX, SPI_SCL_PIN);
    ...
}
```

**"先 `gpio_bit_set()` 再 `gpio_mode_set()`"的顺序是有意的**：先把输出锁存器置成想要的电平，**再**把引脚切成输出模式——这样引脚一变成输出就是目标电平，**避免中间闪出一个错误电平脉冲**。

> **反过来写会怎样？** 配成输出那一刻引脚输出的是**锁存器里的旧值**（可能是 0），于是 SCL 会先低一下再高——**对某些从机会被当成一个多余的时钟脉冲**。**这是"上电毛刺"类问题的常见来源**（和第 02 篇 LED"先关灯再开总闸"是同一类思考）。

### 4.2 硬件实现（`b32b17a`）

```c
static void msp_spi_hard_init(void)
{
    // GPIO初始化
    rcu_periph_clock_enable(SPI_SCL_RCU);
    gpio_mode_set(SPI_SCL_PORT, GPIO_MODE_AF, GPIO_PUPD_NONE, SPI_SCL_PIN);
    gpio_af_set(SPI_SCL_PORT, SPI_SCL_AF, SPI_SCL_PIN);
    ... MOSI / MISO 同理 ...

    // SPI初始化
    spi_i2s_deinit(SPI_NUM);
    rcu_periph_clock_enable(SPI_RCU);
    spi_parameter_struct spi_init_struct;
    spi_struct_para_init(&spi_init_struct);

    spi_init_struct.device_mode = SPI_MASTER;              // 主从模式
    spi_init_struct.trans_mode = SPI_TRANSMODE_FULLDUPLEX; // 全双工
    spi_init_struct.frame_size = SPI_FRAMESIZE_8BIT;       // 8位数据帧
    spi_init_struct.nss = SPI_NSS_SOFT;                    // NSS信号由软件控制
    spi_init_struct.endian = SPI_ENDIAN_MSB;               // 高位在前
    spi_init_struct.clock_polarity_phase = SPI_PL_PH;      // 极性、相位
    spi_init_struct.prescale = SPI_PRES;                   // 时钟预分频

    spi_init(SPI_NUM, &spi_init_struct);

    // 每次传输1byte
    spi_i2s_data_frame_format_config(SPI_NUM, SPI_FRAMESIZE_8BIT);

    spi_enable(SPI_NUM);
}
```

**六个参数逐个说清**：

| 参数 | 本工程取值 | 含义 |
| --- | --- | --- |
| `device_mode` | `SPI_MASTER` | 主机 |
| `trans_mode` | `SPI_TRANSMODE_FULLDUPLEX` | **全双工**：发一个字节的同时收一个字节 |
| `frame_size` | `SPI_FRAMESIZE_8BIT` | 8 位一帧 |
| `nss` | `SPI_NSS_SOFT` | 片选由软件控制（**所以 CS 要自己用 GPIO 拉**） |
| `endian` | `SPI_ENDIAN_MSB` | 高位先出 |
| `clock_polarity_phase` | **`SPI_PL_PH`（宏，可切换）** | CPOL/CPHA —— **必须和从机手册一致** |
| `prescale` | `SPI_PRES`（`SPI_PSC_4`） | 分频，决定 SCK 频率 |

**收发函数：为什么"写"里也有"读"？**

```c
static void msp_spi_hard_write_byte(uint8_t byte)
{
    while (RESET == spi_i2s_flag_get(SPI0, SPI_FLAG_TBE));   // 等发送缓冲空
    spi_i2s_data_transmit(SPI0, byte);
    while (RESET == spi_i2s_flag_get(SPI0, SPI_FLAG_RBNE));  // 等接收缓冲非空
    spi_i2s_data_receive(SPI0);                              // ← 必须把收到的读走并丢掉
}

static uint8_t msp_spi_hard_read_byte(void)
{
    while (RESET == spi_i2s_flag_get(SPI0, SPI_FLAG_TBE));
    spi_i2s_data_transmit(SPI0, 0x00); // 发送数据主要是为了控制时钟信号线
    while (RESET == spi_i2s_flag_get(SPI0, SPI_FLAG_RBNE));
    return spi_i2s_data_receive(SPI0);
}
```

**这两段是理解 SPI 硬件外设的关键**：

| 现象 | 原因 |
| --- | --- |
| "只是发一个字节，为什么要读一次？" | **全双工硬件里"发"和"收"是同一个动作**：给出 8 个时钟，必然同时收 8 位。**不把接收缓冲读走，它就一直满着**，下一次 `RBNE` 判断会立刻通过，数据就错乱了 |
| "读的时候为什么还要发 0x00？" | **时钟是你发数据时产生的**：不发点东西就没有 SCK，从机也就不会给你数据。代码注释写得很直白：`发送数据主要是为了控制时钟信号线` |
| 为什么不用 `SPI_FLAG_BSY` 等待 | 简易写法靠 `RBNE` 就够（收完说明这一轮结束）；严谨做法会再等 `BSY` 清零以确保时钟完全停止 |

> **这解释了第 18 篇里那个"读字库"函数的实现方式**：要读 N 个字节，就得**发 N 个 0x00 去"泵"出时钟**，再逐个把收到的字节存下来。

### 4.3 合并（`5334620`）：和 IIC 用同一套套路

```c
// msp_spi.h
// 软硬件SPI选择
// 1:硬件SPI  0:软件SPI
#define SPI_HARD_SOFT_SWITCH 0

#if SPI_HARD_SOFT_SWITCH
#define SPI_SCL_AF  GPIO_AF_5
#define SPI_MOSI_AF GPIO_AF_5
#define SPI_MISO_AF GPIO_AF_5
#define SPI_RCU     RCU_SPI0
#define SPI_NUM     SPI0
#define SPI_PL_PH   SPI_CK_PL_HIGH_PH_2EDGE
#define SPI_PRES    SPI_PSC_4
#else
#define SPI_SCL_L     gpio_bit_reset(GPIOA, GPIO_PIN_5)
#define SPI_SCL_H     gpio_bit_set(GPIOA, GPIO_PIN_5)
#define SPI_MOSI_L    gpio_bit_reset(GPIOA, GPIO_PIN_7)
#define SPI_MOSI_H    gpio_bit_set(GPIOA, GPIO_PIN_7)
#define SPI_MISO_READ gpio_input_bit_get(GPIOA, GPIO_PIN_6)
#endif
```

```c
// msp_spi.c —— 和 msp_iic.c 一模一样的三段结构
// ============ 声    明 ============
#if SPI_HARD_SOFT_SWITCH
static void msp_spi_hard_init(void); ...
#else
static void msp_spi_soft_init(void); ...
#endif

// ============ 外部接口 ============
void msp_spi_init(void)          { #if ... 硬 #else 软 #endif }
void msp_spi_write_byte(uint8_t) { #if ... 硬 #else 软 #endif }
uint8_t msp_spi_read_byte(void)  { #if ... 硬 #else 软 #endif }
uint8_t msp_spi_read_write_byte(uint8_t) { ... }   ← 10-07 由 18cec36 补上（§4.5）

// ============ 内部实现 ============
#if SPI_HARD_SOFT_SWITCH
... 硬件 ... 
#else
... 软件 ...
#endif
```

**和 IIC 的合并方式完全一致**（第 15 篇 第七章）：**开关宏 + 三段结构 + 外部接口零改动**。**这说明作者已经把"双实现合并"沉淀成了一个可复用的模板**——第三次遇到（串口 DMA、IIC、SPI）就直接照抄结构了。

### 4.4 ⚠️ 合并没做干净的两处（真实的工程遗留）

| 问题 | 表现 | 应该怎么收尾 |
| --- | --- | --- |
| **两套硬实现并存** | `msp_spi.c` 里内联了一份硬实现（宏开关用），`msp_spi_hard.c` 里**还有一份独立文件**（历史遗留，仍在编译列表里） | 删掉 `msp_spi_hard.c/h` 与对应的 `eide.yml` 条目，只保留内联版 |
| **两份的 CPOL/CPHA 不一致** | 内联版 `SPI_CK_PL_HIGH_PH_2EDGE`（Mode 3），独立版 `SPI_CK_PL_LOW_PH_1EDGE`（Mode 0） | **以从机器件手册为准，只留一个正确值** |
| 硬实现里 `SPI0` 写死 | `spi_i2s_flag_get(SPI0, ...)`、`spi_i2s_data_transmit(SPI0, ...)` 没用 `SPI_NUM` | 统一改成 `SPI_NUM`（和 IIC 里 `I2C0` 硬编码是同一类问题） |

> **这三处不值得嘲笑，反而很有代表性**：**"合并"永远不是"写个 `#if` 就完事了"，还包括删掉旧文件、统一常量、对齐配置。** 自己动手时把这三件事记成清单，就不会留下这类"能跑但是脏"的状态。

### 4.5 `18cec36`：为 SPI Flash 补一个真正的全双工接口（2026-10-07）

**为什么原来的接口不够用**：`msp_spi` 原本只提供"只写"和"只读"两个动作：

```c
void    msp_spi_write_byte(uint8_t byte);   // 发一个字节，收的丢掉
uint8_t msp_spi_read_byte(void);            // 先发 0x00 再收一个字节 ← 多花 8 个时钟！
```

SPI OLED 只需要"往屏幕写"，所以够用（第 18 篇）。但 **SPI Flash 的每个事务都是"边写边读"**（发 `90h` 的同时就要读回 ID、发 `05h` 的同时读回状态）——用"发一个再收一个"会**多插 8 个时钟**，协议上直接错位。于是这次提交补上：

```c
// msp_spi.h
uint8_t msp_spi_read_write_byte(uint8_t byte);   // 读写1个byte

// msp_spi.c —— 依旧是"外部接口 + 三段结构"的老套路
uint8_t msp_spi_read_write_byte(uint8_t byte)
{
#if SPI_HARD_SOFT_SWITCH
    return msp_spi_hard_read_write_byte(byte);
#else
    return msp_spi_soft_read_write_byte(byte);   // Mode 0：SCL 低写字、SCL 高读位
#endif
}
```

软件实现就是 `msp_spi_soft_write_byte()` 和 `msp_spi_soft_read_byte()` 的**合并版**——**一次循环 8 拍，写一位、读一位**：

```c
static uint8_t msp_spi_soft_read_write_byte(uint8_t byte)
{
    uint8_t i, read = 0;
    for (i = 0; i < 8; i++) {
        SPI_SCL_L;                       // 时钟低：准备数据
        read <<= 1;                      // 先左移，腾出最低位
        byte & 0x80 ? SPI_MOSI_H : SPI_MOSI_L;   // 写一位（高位在前）
        SPI_SCL_H;                       // 时钟高：对方此刻采样，同时我采样对方
        if (SPI_MISO_READ) read++;       // 读一位
        byte <<= 1;
    }
    return read;
}
```

**⚠️ 硬件分支里有一个"暂时不发作"的 bug**：

```c
static uint8_t msp_spi_hard_read_write_byte(uint8_t byte)   // ← 形参叫 byte
{
    while (RESET == spi_i2s_flag_get(SPI_NUM, SPI_FLAG_TBE));
    spi_i2s_data_transmit(SPI_NUM, dat);   // ★ dat 未声明！应该是 byte
    ...
}
```

因为 `SPI_HARD_SOFT_SWITCH` 当前是 **0（软件 SPI）**，这个分支**根本不参与编译**，所以 EIDE 里一直是"绿色"的；
**一旦把宏改成 1，立刻编译报错**。这就是"双实现合并"留下的第 4 处尾巴（上面 §4.4 那三处的同类问题）。
（顺带一提：这个新函数里用的是 `SPI_NUM` 而不是 `SPI0`——**方向是对的，正是 §4.4 最后一行的建议**。）

> **本节的意义**：这是"**接口是按需长出来的**"最好的一例——
> 同一份 SPI 抽象层，被 OLED 用时只需要"写"，被 Flash 用时才发现必须"全双工"。
> **而这次扩展没有改动 OLED 一行代码**（宏开关 + 三段结构 + 只增不改）——这正是第 15 篇合并模板的价值所在。

---

## 五、上层怎么用（`bs p_spi_oled.h` 的适配层）

OLED 驱动不直接调 `msp_spi_write_byte()`，而是**先定义一层宏**：

```c
// bsp_spi_oled.h
// 替换宏
#define OLED_WRITE_BYTE(byte)     msp_spi_write_byte(byte)
#define Send_Command_to_ROM(byte) OLED_WRITE_BYTE(byte)
#define Get_data_from_ROM()       msp_spi_read_byte()

// DC  PA2 —— 数据/命令选择
#define OLED_DC_Clr() gpio_bit_reset(GPIOA, GPIO_PIN_2)
#define OLED_DC_Set() gpio_bit_set(GPIOA, GPIO_PIN_2)
// CS1 PA3 —— 屏幕片选
#define OLED_CS_Clr() gpio_bit_reset(GPIOA, GPIO_PIN_3)
#define OLED_CS_Set() gpio_bit_set(GPIOA, GPIO_PIN_3)
// CS2 PC5 —— 字库/Flash 片选
#define OLED_ROM_CS_Clr() gpio_bit_reset(GPIOC, GPIO_PIN_5)
#define OLED_ROM_CS_Set() gpio_bit_set(GPIOC, GPIO_PIN_5)

#define OLED_CMD          0 // 写命令
#define OLED_DATA         1 // 写数据
```

**这层宏的价值**：

| 好处 | 说明 |
| --- | --- |
| **屏蔽"用哪套 SPI"** | 换软/硬实现只影响 `msp_spi_*`，OLED 驱动一行不用改 |
| **把"移植自官方例程"的痕迹隔离住** | `Send_Command_to_ROM` / `Get_data_from_ROM` 是原厂商例程的命名，用宏映射过来，**不用改 500 行移植代码里的函数名** |
| **DC / CS 明确成宏** | OLED 除了 SPI 四线，**还多两根控制线**：DC（命令/数据）和 CS（片选）；挂字库芯片的还有一个 CS2 |

> **SPI 没有地址，全靠 CS**——所以**一拖二（屏幕 + 字库芯片）时必须有 CS1/CS2 两根片选线**，这就是为什么 OLED 的引脚定义里能看到 `CS1`、`CS2` 两个片选。**这是 SPI "无寻址"特性带来的必然结果。**

---

## 六、最终代码速查

```c
// --- Hardware/msp_spi.h ---
#define SPI_HARD_SOFT_SWITCH 0     // 0=软件SPI（当前），1=硬件SPI

void    msp_spi_init(void);
void    msp_spi_write_byte(uint8_t byte);
uint8_t msp_spi_read_byte(void);
```

**参数速查表**：

| 项目 | 软件 SPI | 硬件 SPI |
| --- | --- | --- |
| 引脚 | PA5=SCL，PA7=MOSI，PA6=MISO | 同左（**复用 AF5**） |
| GPIO 模式 | SCL/MOSI：`GPIO_MODE_OUTPUT` + **推挽** + `OSPEED_MAX`；MISO：`GPIO_MODE_INPUT` | 三个都是 `GPIO_MODE_AF` |
| 外设 | 无 | **SPI0**（`RCU_SPI0`，APB2 84 MHz） |
| 速率 | 无固定值（纯 GPIO 翻转，越快越好） | **84 MHz ÷ 4 = 21 MHz** |
| 模式 | 数据在 SCL 低时变化、上升沿采样（等效 Mode 0 时序） | `SPI_PL_PH` 宏（当前配置 `HIGH_PH_2EDGE`）⚠️ |
| 方向切换 | **不需要**（收发各有专线） | 不需要 |
| 超时保护 | 不需要（纯 GPIO） | **无**（`while(!flag)` 有卡死风险，这点不如 IIC） |

**SPI0 引脚复用速查**：

| 信号 | 引脚 | AF |
| --- | --- | --- |
| SCK | PA5 | `GPIO_AF_5` |
| MISO | PA6 | `GPIO_AF_5` |
| MOSI | PA7 | `GPIO_AF_5` |
| （NSS） | PA4 | 本工程用软件 NSS，未使用 |

---

## 七、排查清单

| 现象 | 优先检查 |
| --- | --- |
| 屏幕全黑 / 无任何反应 | CS 没拉低；DC 电平错（把数据当命令发了）；器件没供电 |
| **花屏 / 乱码 / 图标错位** | **CPOL/CPHA 与从机手册不一致**（第一大坑）；或先发/后发的位序（应 MSB 先出） |
| 时钟有、数据有，但从机不响应 | 模式不匹配（从机在另一个边沿采样）；或 CS 极性问题（有的器件高有效） |
| 只有第一个字节生效 | 忘了在"写"里读走接收缓冲（全双工不读会顶住） |
| 读回的数据全是 0x00 / 0xFF | 读的时候没发 `0x00` 去泵时钟；或 MISO 没接 / 器件没选中 |
| 换成硬件 SPI 后不工作 | 忘了 `gpio_af_set(..., GPIO_AF_5, ...)`；或 `SPI_PL_PH` 与软件时序不一致 |
| 一拖二时"读字库"把屏幕搞乱 | CS1/CS2 没分开控制（两个从机同时被选中） |
| 上电瞬间显示异常 | 初始化里"先配 `gpio_bit_set` 再 `gpio_mode_set`"的顺序反了，SCL 多出一个脉冲 |
| 高速时数据出错 | 从机支持的最高 SCK 更低（查手册），把 `SPI_PRES` 加大 |
| 编译报重复定义 | `msp_spi_hard.c` 与 `msp_spi.c` 的内联硬实现同时生效（合并未收尾） |

## 八、自测题

1. SPI 与 I2C 在"线数、寻址、应答、速率、引脚方向"上的区别分别是什么？
2. SPI 为什么可以比 I2C 快很多？（从电气层解释）
3. CPOL 和 CPHA 分别是什么？四种模式怎么对应到 GD32 的宏名？
4. **为什么"模式不匹配"只表现为乱码而不是"完全没反应"？**
5. 硬件 SPI 的 `write_byte()` 里为什么必须把收到的数据读走并丢掉？
6. `read_byte()` 里为什么要先 `data_transmit(0x00)`？注释里那句话怎么理解？
7. `SPI_NSS_SOFT` 意味着什么？CS 由谁拉低？
8. SPI0 的 SCK 频率是多少？写出计算过程（别忘了查总线）。
9. 软件 SPI 为什么不用像软件 I2C 那样来回切引脚方向？
10. 软件 SPI 初始化里"先 `gpio_bit_set` 再 `gpio_mode_set`"的顺序有什么用？反了会怎样？
11. SPI 没有 ACK，工程上怎么确认从机收到了？（举出本工程的做法）
12. 本工程 `msp_spi.c` 和 `msp_spi_hard.c` 有什么问题？"合并"这件事除了写 `#if` 还要做哪些收尾？

## 九、练习题

1. **查手册定模式**：找到 OLED（或板上 SPI Flash）的数据手册，查出它要求的 SPI Mode，然后验证本工程当前配置是否正确，把结论写进代码注释。
2. **收尾**：删掉 `msp_spi_hard.c/h` 及 `eide.yml` 里的对应条目，把内联硬实现作为唯一版本；顺手把里面写死的 `SPI0` 改成 `SPI_NUM`。
3. **加超时**：模仿 IIC 的 `I2C_wait()`，给硬件 SPI 的两个 `while(!flag)` 加超时保护。
4. **降低速率**：把 `SPI_PSC_4` 改成 `SPI_PSC_16`（SCK = 5.25 MHz），观察屏幕显示是否仍然正常、有无差别。
5. **对比实验**：把 `SPI_HARD_SOFT_SWITCH` 在 0/1 之间切换，各刷一次整屏，用逻辑分析仪对比 SCK 频率与一次刷屏耗时。
6. **写"发命令+发数据"封装**：在 `bsp_spi_oled` 里实现 `oled_write_cmd()` / `oled_write_data()`，把 DC 电平切换收进去（现在的写法是 DC 手动拉）。
7. **移植一个新 SPI 器件**：用 `msp_spi_*` 驱动一块 SPI Flash（读 ID → 擦除 → 写入 → 读回校验），体会 `CS` 与"读状态寄存器"在无应答协议里的作用。**——这一题已经由第 24 篇完成了**（`Driver/bsp_flash/`），可以对照着看"从练习题到正式模块"的差距。
8. **修一处遗留**：把 `msp_spi_hard_read_write_byte()` 里的 `dat` 改成 `byte`，然后把 `SPI_HARD_SOFT_SWITCH` 改成 1 编译，验证硬实现能否正常工作（顺带验证 GD25Q32 在 Mode 3 下是否可用）。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `5ce9c77` | 10-06 17:44 | [更新] SPI OLED 软实现 封装（含 SPI 软实现） | 新建 `Hardware/msp_spi/msp_spi.c/h`（+50/+27）：引脚宏定义 + 软件 SPI 收发（`byte & 0x80` + 移位）+ OLED 侧适配宏；同时顺带整理了 IIC 的命名分层 |
| `b32b17a` | 10-06 18:11 | [更新] SPI OLED 硬实现 封装（含 SPI 硬实现） | 新建 `Hardware/msp_spi/msp_spi_hard.c/h`（+51/+12）：AF5 复用 + SPI0 六参数配置（`SPI_CK_PL_LOW_PH_1EDGE` / `SPI_PSC_4`）+ TBE/RBNE 收发 |
| `5334620` | 10-06 19:56 | [更新] SPI OLED 软硬实现合并（当时是 `main` HEAD） | 引入 `SPI_HARD_SOFT_SWITCH` 宏；`msp_spi.c` 重构为三段结构并内联硬实现（+140）；`msp_spi.h` 统一两套宏（+41）；删掉 hard 文件的编译项；顺手修 IIC 一处 |
| `18cec36` | 10-07 17:55 | [更新] flash gd25q32 封装（当时的 `main` HEAD） | 为 SPI Flash 补 `msp_spi_read_write_byte()`（软/硬各一份，§4.5）；本质是"接口按需生长"的第三次扩展——**OLED 侧零改动**。硬实现分支里遗留 `dat` 未声明的编译错误（软分支下不发作） |

**这次实现走的两级台阶**

| 台阶 | 提交 | 解决了什么 |
| --- | --- | --- |
| 1. 软件跑通 | `5ce9c77` | 用纯 GPIO 把手动翻时钟的 SPI 时序写出来（最容易理解协议） |
| 2. 硬件 + 合并 | `b32b17a` `5334620` | 换成 SPI0 外设（21 MHz），再用开关宏把两套实现统一成一个接口 |

**与第 15 篇（IIC）的对照**

| 环节 | IIC | SPI |
| --- | --- | --- |
| 软实现难点 | **SDA 方向切换** + 时序四种组合 | 只需按时钟摆数据（**简单得多**） |
| 硬实现难点 | ACK 提前配置、重复起始 | **全双工"发一个必须读一个"** |
| 双实现合并 | `IIC_HARD_SOFT_SWITCH` | `SPI_HARD_SOFT_SWITCH`（**同一套路**） |
| 本工程遗留问题 | `I2C0` 硬编码、`len=0` 下溢 | **两套硬实现并存 + 模式不一致**；新增 `read_write_byte` 的硬分支里 `dat` 未声明 |

> **同一条总线上还有谁**：`PA5(SCK)` / `PA7(MOSI)` 由 **SPI-OLED（CS=PA3）**、**LCD（CS 另配）**、**GD25Q32 Flash（CS=PA4）** 三个器件共用；
> `PA6(MISO)` 只有 Flash 用（OLED 那句 `OLED_READ_FS0()` 是注释掉的）。
> 所以**同一时刻只能有一个 CS 有效**——这是 SPI "点对点"必须靠片选来"假装"多点的方式（第 22 篇）。

## 参考笔记

- `../../../NOTE/Note/SPI.md` —— SPI 串行外设接口（完整整理版）
  - 第二章「通讯流程」、第三章「CPOL 与 CPHA」= 本篇第二、三章
  - 第四章「存储器分类（为什么 Flash 要用 SPI）」= 本篇第一章的选型讨论
  - 第五章「GD32F4 的 SPI」= 本篇 4.2 节
  - 第六章「实战一：先写软件 SPI」= 本篇 4.1 节
  - 第七章「实战二：换硬件 SPI」= 本篇 4.2 节
  - 第九章「实战四：移植 SPI 屏幕（OLED）」= 第 18 篇
  - 第十章「配置速查」= 本篇第六章
- `../../../NOTE/Textbook/SPI/` —— 教材原文快照：`SPI原理🌟🌟🌟.mhtml`、`GD32F4之SPI查询.mhtml`、`SPI屏幕案例.mhtml`、`SPI Flash🌟.mhtml`、`存储器介绍.mhtml`

> 本笔记仅作学习整理，内容来自本仓库真实提交记录与源码。
