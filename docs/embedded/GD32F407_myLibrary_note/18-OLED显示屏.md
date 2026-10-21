# 18 · OLED 显示屏（IIC 版 + SPI 版）· 学习笔记

> 这一篇讲 **6 次提交**：`e941ecb`（移植 IIC OLED 官方例程）→ `886ba18`（显示 PCF8563 时间）→ `13cf2f3`（引入 SPI OLED + 统一命名）→ `5ce9c77` / `b32b17a` / `5334620`（SPI 软/硬封装与合并）。
> 这块屏是**第 15 篇（IIC）和第 16 篇（SPI）共同的下游用户**——本篇讲"屏幕侧"，总线侧请看那两篇。
> 整理日期：2026-10-06　｜　提交范围：`e941ecb`、`886ba18`、`13cf2f3`、`5ce9c77`、`b32b17a`、`5334620`

## 怎么读这份笔记

| 你的情况 | 建议路线 |
| --- | --- |
| 只想把字显示出来 | 第五章（API 速查）+ 3.3 节（画点与显存的关系） |
| 屏幕花屏/错位 | 第九章排查清单前 4 条 |
| 想搞懂显存怎么组织 | 第三章（页地址模式 + GRAM）——**本模块的核心** |
| 想理解"为什么刷屏那么慢" | 第七章（两种接口刷屏耗时对比） |
| 想学移植官方例程的姿势 | 第六章（提交演进）+ 6.4 节（命名统一的教训） |

## 知识点地图

```
OLED 显示模块
├── 两种接法          4 线 IIC 版 / 8 线 SPI 版（同一块屏，驱动芯片都是 SSD1306 类）
├── 驱动芯片命令      0xAE/0xAF 开关显示、0xB0+页、0x00/0x10 列地址、0x40 数据前缀
├── 页地址模式        8 页 × 128 列；**一个字节 = 竖着 8 个像素**
├── 显存 GRAM          IIC 版用 OLED_GRAM[144][8] 缓冲 + refresh() 整屏刷新
├── 画图原语           画点 → 画线 / 画圆 / 字符 / 汉字 / 图片 / 滚动
├── 字库               IIC 版：编译进 Flash 的 oledfont.h；SPI 版：板上**字库芯片**（通过 MISO 读）
├── SPI 版的三根控制线   DC（命令/数据）、CS1（屏幕片选）、CS2（字库片选）
├── 两种刷屏耗时        I2C 400 kHz ≈ 24 ms；软件 I2C ≈ 38 ms；SPI 21 MHz ≈ 0.4 ms
├── 命名统一           从官方例程的 OLED_* 全部改成 bsp_iic_oled_*
└── 上层用法           整幅背景图 + 局部覆盖文字（main.c 的 oled_show_rtc）
```

## 学习目标

- 说清 OLED 的"页地址模式"，能自己算出某个坐标对应显存的哪一位
- 掌握"显存 → 屏幕"的刷新流程，理解为什么要有 GRAM 这一层
- 会区分"命令"和"数据"（DC 引脚 / 0x00 与 0x40 前缀）
- 说清 IIC 版和 SPI 版在**线数、速率、字库来源**上的区别
- 理解"移植官方例程"要做哪些改造（尤其**命名统一**）
- 会算一次整屏刷新需要多少数据量、大概多久

---

## 一、一块屏，两种接法

本工程用了**两块 OLED 模块**（或同一块屏的两种接法），引脚完全不同：

| | **IIC 版**（`bsp_iic_oled`） | **SPI 版**（`bsp_spi_oled`） |
| --- | --- | --- |
| 线数 | **4**（VCC/GND/SCL/SDA） | **8** |
| 数据线 | SDA = **PB7** | MOSI = **PA7**、MISO = **PA6** |
| 时钟线 | SCL = **PB6** | SCL = **PA5** |
| 额外控制 | 无 | **DC = PA2**（数据/命令）、**CS1 = PA3**（屏幕片选）、**CS2 = PC5**（字库片选） |
| 速率 | 100 k / 400 kHz | **最高 21 MHz**（本工程配置） |
| 显存 | **软件 GRAM**（`OLED_GRAM[144][8]`）+ `refresh()` | 直接写屏（无软件显存） |
| 字库 | **编译进 Flash**（`oledfont.h` 426 行 + `bmp.h` 142 行） | **板上字库芯片**（通过 MISO 读，无需占用 MCU Flash） |
| 占用 MCU 资源 | 2 个引脚 + ~几 KB Flash | 6 个引脚 + 很少 Flash |

**为什么会有两种版本？** 因为这是**学习工程**——同一块屏用两种总线驱动一遍，正好把第 15、16 篇的总线知识落到实物上，还能做性能对比（第七章）。

---

## 二、驱动芯片：命令与数据的区分

OLED 模块内部是 **SSD1306 类**驱动芯片（128×64 分辨率）。MCU 只能通过"发命令"和"发数据"来控制它。

**怎么区分命令和数据？**

| 接口 | 区分方式 |
| --- | --- |
| **IIC** | **用"控制字节"前缀**：`0x00` = 后面是命令，`0x40` = 后面是数据 |
| **SPI** | **用 DC 引脚**：DC=0 = 命令，DC=1 = 数据 |

**本工程两种写法的对照**：

```c
// IIC 版：cmd 参数决定前缀字节
void bsp_iic_oled_write_byte(uint8_t dat, uint8_t mode)
{
    ...
    if (mode)  // 数据
        msp_iic_write_nbyte(0x78 >> 1, 0x40, &dat, 1);   // ← 0x40 前缀 = 数据
    else       // 命令
        msp_iic_write_nbyte(0x78 >> 1, 0x00, &dat, 1);   // ← 0x00 前缀 = 命令
}

// SPI 版：DC 引脚决定
void bsp_spi_oled_write_byte(uint8_t dat, uint8_t cmd)
{
    if (cmd)                 // 数据 拉高DC
        OLED_DC_Set();
    else                     // 指令 拉低DC
        OLED_DC_Clr();

    OLED_CS_Clr();           // 拉低片选 开始通信
    OLED_WRITE_BYTE(dat);    // 发 1 个字节（内部走 msp_spi_write_byte）
    ...
}
```

```c
#define OLED_CMD          0 // 写命令
#define OLED_DATA         1 // 写数据
```

> **注意 IIC 版的 `0x78 >> 1`**：模块资料上写的是 `0x78`（8 位地址形式），**I2C 库函数要的是 7 位地址（`0x3C`）**，所以这里右移一位。**这正是第 15 篇第四章说的"7 位地址 vs 8 位地址"最实际的例子**——写驱动时被坑一次就记住了。

### 2.1 常用命令速查

| 命令 | 作用 |
| --- | --- |
| `0xAE` / `0xAF` | 关显示 / 开显示 |
| **`0xB0 + page`** | **设置页地址**（0~7 页） |
| **`0x00 + low`** | 设置列地址**低 4 位** |
| **`0x10 + high`** | 设置列地址**高 4 位** |
| `0x40`（IIC 控制字节）/ DC=1（SPI） | 后面跟着的是**显存数据** |
| `0xA1` / `0xA0` | 列地址映射方向（左右镜像） |
| `0xC8` / `0xC0` | 行扫描方向（上下镜像） |
| `0x81` + 值 | 对比度/亮度 |
| `0x2E` / `0x2F` | 关 / 开滚动 |

**`bsp_iic_oled_display_turn()` 就是用 `0xA1/0xA0` + `0xC8/0xC0` 实现"屏幕旋转 180°"**；`bsp_iic_oled_color_turn()` 则是 `0xA6/0xA7`（正常/反色）。

---

## 三、显存：页地址模式与 GRAM（本模块的核心）

### 3.1 屏幕的"坐标"和显存不是一一对应的

**这是 OLED 驱动最容易晕的地方**。SSD1306 的显存是按**页（Page）**组织的：

```
屏幕 128 列 × 64 行
       ↓ 分成 8 页（每页 8 行）
┌──────────────────────────────────┐
│ page0 │ 第 0~7 行                  │
│ page1 │ 第 8~15 行                 │
│ page2 │ 第 16~23 行                │
│ ...   │                            │
│ page7 │ 第 56~63 行                │
└──────────────────────────────────┘

显存里每个字节 = 某一页、某一列的 8 个像素（竖向 8 个点）
                 bit0 = 这一页最上面那行
                 bit7 = 这一页最下面那行
```

**画个图就清楚了**：

```
   列 x  →   0    1    2   ...
页0 ┌──┐  ┌────┬────┬────┐
列0 │  │  │bit0│    │    │  ← GRAM[x][0] 的 bit0
行0 │  │  ├────┼────┼────┤
    │  │  │bit1│    │    │
    ...
行7 │  │  │bit7│    │    │
    ├──┤  ├────┼────┼────┤
页1 │  │  │    │    │    │  ← GRAM[x][1]
行8 │  │  │    │    │    │
    ...

⇒ 坐标 (x, y) 对应：GRAM[x][y/8] 的第 (y%8) 位
```

**本工程的 GRAM 定义**：

```c
uint8_t OLED_GRAM[144][8];   // 144 列（屏只有 128 列，多留一点）× 8 页
```

### 3.2 画点：整个绘图体系的地基

```c
void bsp_iic_oled_draw_point(uint8_t x, uint8_t y, uint8_t t)
{
    uint8_t i, m, n;
    i = y / 8;              // ← 算出在哪一页
    m = y % 8;              // ← 算出在这一页的第几位
    n = 1 << m;             // ← 位掩码
    if (t)                  // t=1 点亮
        OLED_GRAM[x][i] |= n;
    else                    // t=0 熄灭
    {
        OLED_GRAM[x][i] = ~OLED_GRAM[x][i];   // 取反
        OLED_GRAM[x][i] |= n;                 // 置位
        OLED_GRAM[x][i] = ~OLED_GRAM[x][i];   // 再取反 → 相当于清位
    }
}
```

**注意"清位"的写法**：

```c
OLED_GRAM[x][i] &= ~n;      // ← 标准写法（本工程没这么写）
// 本工程写的是：取反 → 置位 → 再取反
// 效果完全一样，但可读性差很多
```

> **小建议**：`x &= ~n` 是 C 语言里"清某一位"的标准写法，**应该优先用**。这里的"取反两次"写法虽然结果正确，但读代码的人需要停下来想一秒。

**所有绘图功能都建立在"画点"上**：

| 函数 | 怎么用画点实现 |
| --- | --- |
| `draw_line` | 逐点填（直线插值） |
| `draw_circle` | 按圆方程逐点填 |
| `show_char` / `show_string` | 从字库里取出点阵的每个字节，按位判断"这一位要不要亮"，画点 |
| `show_chinese` | 同上（汉字点阵更大：16×16 / 24×24 / 32×32 / 64×64） |
| `show_picture` | 直接把 BMP 的字节按页写进 GRAM |
| `show_number` | 拆位 + 调 `show_char` |

**这就是"分层"在图形驱动里的体现**：**最底层只有"画点"一个动作，上面全是组合。**

### 3.3 刷新：把 GRAM 整屏推给屏幕

**改 GRAM 只是改了内存，屏幕不会变**——必须调 `refresh()` 把数据推过去：

```c
void bsp_iic_oled_refresh(void)
{
    uint8_t i, n;
    for (i = 0; i < 8; i++)                          // 8 页逐页刷
    {
        bsp_iic_oled_write_byte(0xb0 + i, OLED_CMD); // 设置行起始地址（页）
        bsp_iic_oled_write_byte(0x00, OLED_CMD);     // 设置低列起始地址
        bsp_iic_oled_write_byte(0x10, OLED_CMD);     // 设置高列起始地址

        msp_iic_write_col_nbyte(0x78 >> 1, 0x40, &OLED_GRAM[0][i], 8, 128);
        //                                          ↑起点   ↑前缀 ↑步长 ↑个数
    }
}
```

**关键在最后一个参数 `8`**：

```
&OLED_GRAM[0][i]   → 从"第 0 列、第 i 页"开始
步长 8             → 每次跨 8 个字节（正是"一列 8 页"的大小）
个数 128           → 取 128 列
⇒ 取出的正好是"第 i 页的 128 列数据" ✅
```

**这就是第 15 篇里那个特殊函数 `msp_iic_write_col_nbyte()` 存在的唯一原因**——**显存的物理布局（列优先）和屏幕需要的发送顺序（页优先）不一致，必须跨步取数。**

> **一个可以优化的点**：`refresh()` 每次都把**整屏 1024 字节**发出去，哪怕只改了 1 个字符。**更高效的做法是"脏区域刷新"**：记录哪些页被改过，只刷那几页。本工程没做（简单优先），但值得知道。

### 3.4 读一遍 GRAM 的完整生命周期

```
① 上电：bsp_iic_oled_init() → 发一串初始化命令（开关显示、扫描方向、对比度…）
② 画图：show_string / draw_point … → 只改 OLED_GRAM（内存操作，屏幕无变化）
③ 刷新：bsp_iic_oled_refresh() → 8 页 × 128 字节 → 通过 IIC 推给屏幕
④ 屏幕显示更新

特点：所有"画图"都能在内存里反复修改，最后一次刷屏 —— 避免了"画一半被看到"
```

**这个"先缓冲、后刷新"的模式**（双缓冲思想）是**所有图形界的通用做法**：

| 层次 | 本工程 | 类比 |
| --- | --- | --- |
| 应用层写的内容 | `show_string(0, 0, "ABC")` | 画到画布上 |
| 中间缓冲 | `OLED_GRAM[144][8]` | 画布（帧缓冲） |
| 物理设备 | SSD1306 的显存 | 显示器 |
| 提交动作 | `bsp_iic_oled_refresh()` | 翻页/垂直同步 |

> **和第 09 篇数码管的对照**：那里是 `displayBuffer[8]` + 逐位扫描；这里是大得多的 GRAM + 整屏刷新。**"缓冲区 + 后台刷新"这个模式，在显示类器件上是通用的**。

---

## 四、SPI 版：多三根线，换一个能力

### 4.1 八根线分别干什么

| 线 | 引脚 | 作用 |
| --- | --- | --- |
| SCL | PA5 | 时钟（同 SPI 的 SCK） |
| SDA/MOSI | PA7 | 数据出 |
| MISO/FS0 | PA6 | 数据入（**用来读字库芯片**） |
| **DC** | **PA2** | 命令/数据选择 |
| **CS1** | **PA3** | **屏幕**片选 |
| **CS2** | **PC5** | **字库芯片**片选 |

**为什么 SPI 版需要两个片选？**（第 16 篇 4.4 节提过）

```
SPI 没有地址机制 —— 一条总线只能靠 CS 区分设备
屏幕和字库芯片挂在同一组 SPI 线上
⇒ 必须各自一根 CS，同一时刻只拉低一个
```

### 4.2 字库芯片：读出汉字点阵

**IIC 版把字库编译进了 MCU 的 Flash**（`oledfont.h`），**SPI 版则是板上有一颗字库芯片**，需要用 MISO 把它读出来：

```c
void bsp_spi_oled_get_data_form_ROM(uint8_t addrHigh, uint8_t addrMid, uint8_t addrLow, uint8_t *pbuff, uint8_t DataLen)
{
    uint8_t i;
    OLED_ROM_CS_Clr();              // 选中字库芯片（CS2）
    Send_Command_to_ROM(0x03);      // ← 0x03 = 读数据命令
    Send_Command_to_ROM(addrHigh);  // 24 位地址（3 个字节）
    Send_Command_to_ROM(addrMid);
    Send_Command_to_ROM(addrLow);
    for (i = 0; i < DataLen; i++)
    {
        *(pbuff + i) = Get_data_from_ROM();   // ← 发 0x00 泵时钟，读回一个字节
    }
    OLED_ROM_CS_Set();              // 释放
}
```

**这段代码把第 16 篇的两个知识点串起来了**：

| 知识点 | 在这里的体现 |
| --- | --- |
| **读写都要 CS** | `OLED_ROM_CS_Clr()` / `Set()` 包住整次读取 |
| **读要"发一个收一个"** | `Get_data_from_ROM()` 就是 `msp_spi_read_byte()`（内部先发 `0x00` 泵时钟） |

**GB2312 汉字在字库芯片里的地址公式**（代码里带注释，很值得看）：

```c
// 国标简体（GB2312）汉字在晶联讯字库IC中的地址由以下公式来计算：
// Address = ((MSB - 0xB0) * 94 + (LSB - 0xA1) + 846) * 32 + BaseAdd;  BaseAdd = 0
// 由于担心8位单片机有乘法溢出问题，所以分三步取地址
fontaddr = (text[i] - 0xb0) * 94;
fontaddr += (text[i + 1] - 0xa1) + 846;
fontaddr = fontaddr * 32;
```

**这个公式的含义**：

```
GB2312 的汉字用两个字节编码：高字节 0xB0~0xF7、低字节 0xA1~0xFE
   高字节 - 0xB0 = 区号（0 起）
   低字节 - 0xA1 = 位号（0 起）
   区号 × 94 + 位号 = 该字在汉字表中的"序号"（每区 94 个位）
   + 846 = 跳过前面的符号区（1~9 区），直接落到汉字区
   × 32  = 每个 16×16 汉字占 32 字节（16 列 × 2 字节/列）
```

**"分三步算、避免 8 位溢出"这句注释很有价值**——它暗示这份代码源自 **51/STC8 平台**（8 位机乘法容易溢出），**移植到 32 位机上其实可以一次算完**（`uint32_t` 足够）。这是典型的"移植时该不该保留原写法"的判断点。

### 4.3 SPI 版没有软件 GRAM

看 `bsp_spi_oled_write_byte()`：**它直接把字节发给屏幕**，没有 `OLED_GRAM` 这一层：

```c
void bsp_spi_oled_write_byte(uint8_t dat, uint8_t cmd)
{
    if (cmd) OLED_DC_Set(); else OLED_DC_Clr();   // 命令/数据
    OLED_CS_Clr();                                // 片选
    OLED_WRITE_BYTE(dat);                         // 直接发出去
    ...
}
```

| | IIC 版 | SPI 版 |
| --- | --- | --- |
| 软件显存 | **有**（`OLED_GRAM[144][8]`） | **无** |
| 刷新方式 | 改内存 → 手动 `refresh()` | 立刻生效（写完就显示） |
| 优点 | 无闪烁、可局部改、省 I2C 带宽（只在 refresh 时发） | 省 RAM、代码简单 |
| 缺点 | 占 1.1 KB RAM + 要记得 refresh | **改一次发一次，容易看到"逐字出现"的过程** |

**"要不要软件显存"是显示驱动的经典取舍**：RAM 紧张、刷新不频繁 → 不要；要动画/无闪烁 → 要。

---

## 五、API 速查

### 5.1 IIC 版（`bsp_iic_oled.h`）

```c
void bsp_iic_oled_init(void);

/* 基础 */
void bsp_iic_oled_write_byte(uint8_t dat, uint8_t mode);   // mode: OLED_CMD / OLED_DATA
void bsp_iic_oled_refresh(void);                            // ★ 把 GRAM 整屏推给屏幕
void bsp_iic_oled_clear(void);
void bsp_iic_oled_color_turn(uint8_t i);                    // 正常/反色
void bsp_iic_oled_display_turn(uint8_t i);                  // 旋转 180°

/* 绘图（全部基于"画点"） */
void bsp_iic_oled_draw_point(uint8_t x, uint8_t y, uint8_t t);
void bsp_iic_oled_draw_line(uint8_t x1, uint8_t y1, uint8_t x2, uint8_t y2, uint8_t mode);
void bsp_iic_oled_draw_circle(uint8_t x, uint8_t y, uint8_t r);

/* 文字与图片 */
void bsp_iic_oled_show_char(uint8_t x, uint8_t y, uint8_t chr, uint8_t size1, uint8_t mode);
void bsp_iic_oled_show_string(uint8_t x, uint8_t y, uint8_t *chr, uint8_t size1, uint8_t mode);
void bsp_iic_oled_show_number(uint8_t x, uint8_t y, uint32_t num, uint8_t len, uint8_t size1, uint8_t mode);
void bsp_iic_oled_show_chinese(uint8_t x, uint8_t y, uint8_t num, uint8_t size1, uint8_t mode);
void bsp_iic_oled_show_picture(uint8_t x, uint8_t y, uint8_t sizex, uint8_t sizey, uint8_t BMP[], uint8_t mode);
void bsp_iic_oled_scroll_display(uint8_t num, uint8_t space, uint8_t mode);   // 滚动（硬件滚动）
```

**参数含义**：

| 参数 | 含义 |
| --- | --- |
| `x, y` | 左上角坐标（**y 只能是 8 的倍数**？——不一定，看实现，但字符/汉字按页对齐最省事） |
| `size1` | 字号：ASCII 支持 **8 / 12 / 16 / 24**；汉字支持 **16 / 24 / 32 / 64** |
| `mode` | `1` = 正常（白底黑字），`0` = 反色/叠加 |
| `num`（汉字） | **字库数组里的下标**，不是 Unicode 编码（`show_chinese(0,0,0,16,1)` = 显示字库第 0 个字"中"） |
| `BMP[]` | 图片数组（如 `BMP1`，来自 `bmp.h`） |

**⚠️ 汉字用"下标"而不是"编码"**——因为字库是**编译进 Flash 的一个数组**，不是编码表：

```c
bsp_iic_oled_show_chinese(0,  0, 0, 16, 1);   // 中
bsp_iic_oled_show_chinese(18, 0, 1, 16, 1);   // 景
bsp_iic_oled_show_chinese(36, 0, 2, 16, 1);   // 园
```

**这也是 IIC 版和 SPI 版的本质区别**：IIC 版靠"数组下标"，SPI 版靠"GB2312 编码查字库芯片"。**前者只能显示字库里预存的那几个字，后者能显示任意 GB2312 汉字**。

### 5.2 SPI 版（`bsp_spi_oled.h`）

```c
void bsp_spi_oled_init(void);
void bsp_spi_oled_write_byte(uint8_t dat, uint8_t cmd);
void bsp_spi_oled_clear(void);
void bsp_spi_oled_address(uint8_t x, uint8_t y);
void bsp_spi_oled_display_128x64(uint8_t *dp);             // 整屏图
void bsp_spi_oled_display_16x16(uint8_t x, uint8_t y, uint8_t *dp);
void bsp_spi_oled_display_8x16(uint8_t x, uint8_t y, uint8_t *dp);
void bsp_spi_oled_display_5x7(uint8_t x, uint8_t y, uint8_t *dp);
void bsp_spi_oled_display_GB2312_string(uint8_t x, uint8_t y, uint8_t *text);   // ★ 任意汉字
void bsp_spi_oled_display_string_5x7(uint8_t x, uint8_t y, uint8_t *text);
void bsp_spi_oled_show_number(uint8_t x, uint8_t y, float num, uint8_t len);
void bsp_spi_oled_get_data_form_ROM(uint8_t addrHigh, uint8_t addrMid, uint8_t addrLow, uint8_t *pbuff, uint8_t DataLen);
```

> **注意 `bsp_spi_oled_display_GB2312_string(0, 0, "秀儿")` 的写法**（`main.c` 里的真实调用）——**直接传字符串字面量**，而 IIC 版只能传下标。**这就是"字库芯片"带来的能力升级。**

### 5.3 应用层怎么用（`main.c` 的两个真实例子）

**① 测试/演示模式**：`oled_test()` 里把 IIC 版 OLED 的能力演示了一遍（显示图片、中英文字符、不同字号、滚动）。

**② 显示 RTC 时间**（本工程最终的主循环用法）：

```c
void oled_show_rtc(Time_pcf *t)
{
    char buf[32] = {0};

    // 1. 先显示 BMP1 整幅背景（128x64）
    //    这一步会覆盖上次 GRAM，保证背景干净
    bsp_iic_oled_show_picture(0, 0, 128, 64, BMP1, 1);

    // 2. 在 BMP1 原本 "2014/05/01" 的位置覆盖显示日期
    sprintf(buf, "20%02d/%02d/%02d", t->year % 100, t->month, t->day);
    bsp_iic_oled_show_string(36, 38, buf, 8, 1);

    // 4. 在 BMP1 原本 "ASCII: CODE:" 的位置覆盖显示时间
    sprintf(buf, "%02d:%02d:%02d", t->hour, t->minutes, t->second);
    bsp_iic_oled_show_string(36, 2, buf, 8, 1);

    bsp_iic_oled_refresh();
}
```

**这个"整幅背景 + 覆盖文字"的套路值得学**：

```
问题：数字每秒都在变，如果只写新数字，旧数字的残留会叠在一起（比如 "12" → "8" 会留下痕迹）
解法：每次先把整幅背景重画一遍（相当于擦干净），再写新数字
好处：不需要"擦除逻辑"（不用知道上次写的是什么、占多宽）
代价：每次刷屏都是 1024 字节
```

**这就是"用带宽换简单"的典型选择**——也是第七章那个耗时数字为什么重要的原因。

---

## 六、提交演进

### 6.1 `e941ecb`：移植 IIC OLED 官方例程

**提交信息**：`[更新] 初步移植 IIC OLED屏幕官方例程`（+1236 行，其中 `oledfont.h` 426 行、`bmp.h` 142 行、`bsp_iic_oled.c` 556 行）

**移植一个显示模块要带哪几样东西**：

| 文件 | 内容 | 大小 |
| --- | --- | --- |
| `bsp_iic_oled.c/h` | 驱动逻辑（初始化、命令、画点、字符、汉字、图片、滚动） | 556 行 |
| **`oledfont.h`** | **字库点阵**（ASCII 6×8/6×12/8×16/12×24 + 汉字 16×16/24×24/32×32/64×64） | 426 行 |
| **`bmp.h`** | **图片数组**（`BMP1` 等全屏图） | 142 行 |

**"移植"通常只改驱动，不改字库和图片**——字库是"数据"，与平台无关。

**移植时必须改的四处**（和第 17 篇 PCF8563 的移植清单一样）：

| 项 | 原例程（多为 51/STM32） | 本工程 |
| --- | --- | --- |
| 总线收发 | 自己 bit-bang I2C | **换成 `msp_iic_*`** |
| 延时 | 原平台延时 | **换成 `delay_1ms/delay_1us`** |
| 类型 | `u8/u16/unsigned char` | `uint8_t/uint16_t` |
| 引脚宏 | `GPIO_SetBits(GPIOB, GPIO_Pin_6)` | `gpio_bit_set(GPIOB, GPIO_PIN_6)` |

### 6.2 `886ba18`：显示 PCF8563 时间

**提交信息**：`[更新] IIC OLED 显示 pcf8563 时间`（跨模块：`bsp_iic_oled` 71 行、`msp_iic` 113 行、`main.c` 57 行）

这就是 5.3 节的 `oled_show_rtc()`。**这次提交是"三个模块串起来"的时刻**：

```
PCF8563（第 17 篇）→ IIC 总线（第 15 篇）→ OLED（本篇）
     ↑ 提供数据           ↑ 传输通道          ↑ 显示
```

**同时为了 OLED 刷屏，第 15 篇的 `msp_iic` 加了 `write_col_nbyte()`**——这就是"下游器件的需求反过来改上游驱动"的典型（第 15 篇 5.3 节）。

### 6.3 `13cf2f3`：引入 SPI OLED + **统一命名**

**提交信息**：`[更新] SPI OLED`（`bsp_iic_oled.c` 改 166 行、新建 `bsp_spi_oled.c/h` 413+52 行、`main.c` 78 行）

这次提交做了两件看起来无关、其实配套的事：

**① 新增 SPI 版 OLED**（413 行驱动）。

**② 把 IIC 版所有函数重命名**：

```diff
-void OLED_ColorTurn(uint8_t i);
+void bsp_iic_oled_color_turn(uint8_t i);

-void OLED_WR_Byte(uint8_t dat, uint8_t mode);
+void bsp_iic_oled_write_byte(uint8_t dat, uint8_t mode);

-void OLED_Clear(void);
+void bsp_iic_oled_clear(void);

-void OLED_DrawPoint(uint8_t x, uint8_t y, uint8_t t);
+void bsp_iic_oled_draw_point(uint8_t x, uint8_t y, uint8_t t);
...
```

**为什么要重命名？三个理由，每个都真实存在**：

| 理由 | 说明 |
| --- | --- |
| **两套驱动共存必须消歧** | 原来的 SPI 版也叫 `OLED_ColorTurn` / `OLED_ShowString`——**两个 `.c` 里的同名函数直接链接冲突**。加上 `iic` / `spi` 前缀就分开了 |
| **符合本工程命名规范** | 本工程 `bsp_`（片外器件）+ 器件名 + 动作（第 01 篇的命名约定） |
| **避免和库/第三方冲突** | `OLED_xxx` 这种"大写的通用名"很容易和别人撞（官方例程、其他屏幕库都用它） |

> **这是本工程**"命名规范从'能用'到'成体系'"的一个重要转折点**：早期（第 02/03 篇）就已经定下 `bsp_xxx_open()` 这类风格，但移植来的代码往往保留原例程的大驼峰命名。**移植的最后一步应该是"改名"**——否则时间一长，谁都说不清 `OLED_ShowString` 到底属于哪块屏。

### 6.4 `5ce9c77` / `b32b17a` / `5334620`：SPI 侧的分层

这三次提交主要是**第 16 篇（SPI 总线）**的内容，对 OLED 的影响是：

| 提交 | 对 OLED 的影响 |
| --- | --- |
| `5ce9c77` | OLED 通过 `OLED_WRITE_BYTE` 宏接上软件 SPI；同时把 IIC 的命名分层也整理了一遍 |
| `b32b17a` | 硬实现接入后，OLED 代码**一行不用改**（因为宏名没变） |
| `5334620` | 软硬合并，同样对 OLED 透明 |

**验证了"抽象层"的价值**：**OLED 驱动只认 `OLED_WRITE_BYTE` 这个宏，底下换软/硬 SPI 它完全不知情。**

```c
#define OLED_WRITE_BYTE(byte)     msp_spi_write_byte(byte)   // 这层薄宏是"隔离墙"
```

---

## 六之二、★ 一次真实的编码事故（`1da26c5`，10-15 22:08）

**提交信息**：「**main 编码必须为 gb2312**  `bsp_spi_oled_display_GB2312_string`」

**这次提交改了什么**：`User/main.c` **78 行，全是中文注释**——把乱码恢复成正常中文：

```diff
- // 涓插彛鎺ユ敹鍥炶皟
+ // 串口接收回调

- // 閰嶇疆鍓╀綑鍙傛暟
+ // 配置剩余参数

- // 鍚�鍔―MA浼犺緭
+ // 启动DMA传输
```

**"涓插彛"是怎么来的**：这是 **UTF-8 字节被当成 GB2312 解释**的经典乱码——
"串"的 UTF-8 是 `E4 B8 B2`，用 GB2312 两个字节一读，就成了"涓"+"插"。

**为什么这件事和 OLED 有关**（这才是重点）：

```c
bsp_spi_oled_display_GB2312_string(0, 0, "不要瞎搞");   // ← 直接把字符串字面量的字节送给字库芯片
```

| 源文件编码 | "不"在内存里的字节 | 字库芯片怎么查 | 结果 |
| --- | --- | --- | --- |
| **GB2312** | `B2 BB`（2 字节） | 按 `B2BB` 查到字模 | ✅ 正常显示 |
| **UTF-8** | `E4 B8 8D`（3 字节） | 把 `E4B8` 当索引 → 查不到；剩下的 `8D` 又和下一个字节拼 | ❌ **乱码 / 空白 / 错字** |

**所以"文件编码"不是编辑器偏好，而是"数据的一部分"** ——
`display_GB2312_string()` **不做转码**，它假设"字符串字节就是 GB2312"。

> **这也是 SPI 版和 IIC 版一个隐含的区别**：
> IIC 版靠"数组下标"（第几号字），**跟源文件编码无关**；
> SPI 版靠"GB2312 编码查字库"，**源文件编码直接决定显示对不对**。

**三条教训**（工程 `Doc/` 里也写了同样的话）：

1. **本工程所有 `.c/.h` 必须保持 GB2312/GB18030 + CRLF**；
2. **用工具/脚本/AI 改这类文件时，必须按原编码读写** —— 用 UTF-8 覆盖会把所有中文注释打成乱码；
3. **一旦被覆盖，`git diff` 会显示"整片都是改动"**（本次 78 行全是注释），
   **review 时很容易误判成"改了逻辑"** —— 看到这种 diff，先怀疑编码，别急着看代码。

---

## 七、两种接口的刷屏耗时对比（本章值得自己算一遍）

**数据量**：128 × 64 像素 ÷ 8 = **1024 字节**（整屏），加上每页的命令开销约 32 字节 → **约 1056 字节**。

**I2C 的算法**（每字节带 1 位 ACK → 9 位；再加上每次事务的起始/地址开销）：

```
软件 I2C（本工程默认，半周期 2 μs → 约 250 kHz）：
    1056 字节 × 9 位 = 9504 位
    9504 / 250 000 ≈ 38 ms

硬件 I2C（400 kHz）：
    9504 / 400 000 ≈ 24 ms
```

**SPI 的算法**（无 ACK，每字节 8 位）：

```
硬件 SPI（21 MHz）：
    1056 × 8 = 8448 位
    8448 / 21 000 000 ≈ 0.40 ms
```

**对比表**：

| 接口 | 位宽/字节 | 有效位数 | 时钟 | **整屏刷新耗时** | 相对速度 |
| --- | --- | --- | --- | --- | --- |
| 软件 I2C（默认） | 8+1 | 9504 | ≈250 kHz | **≈38 ms** | 1× |
| 硬件 I2C | 8+1 | 9504 | 400 kHz | **≈24 ms** | 1.6× |
| **硬件 SPI** | 8 | 8448 | 21 MHz | **≈0.4 ms** | **≈95×** |
| 软件 SPI（GPIO 翻转） | 8 | 8448 | 取决于 CPU（估计几百 kHz~1 MHz 级） | 约 10~20 ms | 约 2~4× |

**三个结论**：

| 结论 | 说明 |
| --- | --- |
| **SPI 刷屏比 I2C 快两个数量级** | 这就是"高带宽场合选 SPI"（第 16 篇）的量化依据 |
| **I2C 的"ACK 位"是隐性成本** | 每字节多 1 位 = 多 12.5% 的时间；速率又低 |
| **本工程"每秒刷一次整屏"完全够用** | 38 ms ≪ 1000 ms；但**如果要做动画（>25 帧/秒），I2C 版直接出局**（每帧 38 ms = 最高 26 帧/秒，还得全给刷新用） |

> **⚠️ 实际提醒**：`oled_show_rtc()` 里**每次刷新还要先发整幅背景图**（`show_picture` 只是写 GRAM，不额外占 I2C 带宽；带宽只花在 `refresh()` 上）。所以刷屏耗时就是上表的 38 ms。**但要注意：主循环里 `msp_adc_get()` + 读 PCF8563 也要走 I2C**——**它们和 OLED 抢同一条总线**，所以实际一轮循环耗时 = 38 ms + ADC/PCF8563 的 I2C 时间。**如果再加上窗口看门狗（窗口 1.66 ms）就会立刻复位**——这也解释了为什么 `main.c` 里 `msp_wwdgt_config()` 被注释掉了（第 12 篇）。

---

## 八、最终代码速查

**关键常量**：

| 项目 | IIC 版 | SPI 版 |
| --- | --- | --- |
| 设备地址 | `0x78 >> 1` = **`0x3C`**（7 位） | 无（靠 CS1） |
| 命令前缀 | 控制字节 `0x00` | DC = 0 |
| 数据前缀 | 控制字节 `0x40` | DC = 1 |
| 分辨率 | 128 × 64 | 128 × 64 |
| 显存 | `OLED_GRAM[144][8]`（144×8 = 1152 字节） | 无 |
| 刷新 | `bsp_iic_oled_refresh()`（8 页 × 128 字节） | 写完即显示 |
| 汉字来源 | `oledfont.h`（**数组下标**） | 字库芯片（**GB2312 编码**） |
| 命令引脚 | — | DC = PA2 |
| 片选 | — | CS1 = PA3（屏幕）、CS2 = PC5（字库） |

**常用命令（两种接口通用）**：

```c
0xAE / 0xAF                // 关显示 / 开显示
0xB0 + page                // 设置页（0~7）
0x00 + (col & 0x0F)        // 列地址低 4 位
0x10 + (col >> 4)          // 列地址高 4 位
0xA1 / 0xA0                // 列方向（旋转）
0xC8 / 0xC0                // 行方向（旋转）
0xA6 / 0xA7                // 正常 / 反色
```

**GRAM 坐标公式（背下来）**：

```
屏幕坐标 (x, y)  →  OLED_GRAM[x][y / 8] 的第 (y % 8) 位
    y / 8 = 页号（0~7）
    y % 8 = 页内第几行（0~7，bit0 在上）
```

---

## 九、排查清单

| 现象 | 优先检查 |
| --- | --- |
| 全屏黑，什么都不显示 | `bsp_iic_oled_init()` / `bsp_spi_oled_init()` 没调；没开显示（`0xAF`）；对比度设为 0 |
| 一个像素都不亮但"通信正常" | `refresh()` 没调用（**改了 GRAM 不刷新 = 屏幕不变**，IIC 版最常见的坑） |
| 显示内容整体错位/花屏 | 页/列地址设置顺序错；`write_col_nbyte` 的 `offset` 不是 8；GRAM 坐标算错（`y/8` 与 `y%8` 搞反） |
| 显示的是镜像/倒着的 | `0xA1/0xA0` 与 `0xC8/0xC0` 组合不对（4 种组合里挑） |
| 反色（黑底白字变白底黑字） | `0xA6/0xA7` 配反了；或 `show_xxx()` 的 `mode` 参数传反 |
| 文字上下叠在一起/有残影 | 每次刷新前没重画背景（IIC 版要按 `oled_show_rtc()` 的套路：**先整幅背景再覆盖文字**） |
| **IIC 版：地址写 `0x78` 不通** | I2C 库要 **7 位地址**，必须 `0x78 >> 1` |
| **SPI 版：汉字显示不出来** | 字库芯片 CS2 没拉低；没发 `0x03` 读命令；地址公式算错 |
| SPI 版：屏幕和字库"打架" | CS1/CS2 同时被拉低（SPI 无地址，只能靠片选区分） |
| SPI 版：屏幕花屏 | CPOL/CPHA 与屏幕手册不一致（第 16 篇 第三章） |
| 改了字库但显示乱码 | 字库数组下标与显示函数不匹配（IIC 版汉字是**下标**不是编码） |
| 刷屏明显卡顿、动画掉帧 | I2C 带宽不够（整屏 38 ms）；换 SPI 或改用"脏区域刷新" |
| 刷屏后系统复位 | 刷屏耗时把看门狗窗口撑破了（尤其 WWDGT 1.66 ms），检查喂狗位置 |
| 显存改了但局部不更新 | 只调了 `refresh()` 的整体刷新，没做局部刷新（本工程没实现） |
| RAM 不够用 | IIC 版 `OLED_GRAM[144][8]` 占 1152 字节；可缩成 `[128][8]`（1024 字节） |

## 十、自测题

1. IIC 版和 SPI 版 OLED 各占几个引脚？分别多了哪些控制线？为什么 SPI 版需要两个片选？
2. 屏幕坐标 `(x, y)` 怎么映射到 `OLED_GRAM`？`y/8` 和 `y%8` 分别是什么？
3. 为什么改完 GRAM 屏幕不会变？必须调哪个函数？
4. IIC 版怎么区分"命令"和"数据"？SPI 版怎么区分？
5. 为什么 IIC 版要写 `0x78 >> 1`？直接写 `0x78` 会怎样？
6. `msp_iic_write_col_nbyte()` 的 `offset` 传 8 是什么意思？这个参数为什么必须存在？
7. IIC 版显示汉字为什么传"下标"，SPI 版却能传字符串？这个差别来自哪里？
8. SPI 版的 GB2312 地址公式里，`×94`、`+846`、`×32` 分别代表什么？
9. "先画背景再覆盖文字"解决了什么问题？代价是什么？
10. 算一下：硬件 I2C（400 kHz）刷一次整屏要多久？硬件 SPI（21 MHz）呢？差几倍？
11. 为什么 `bsp_iic_oled_refresh()` 要分 8 次发（每次 128 字节），而不是一次发 1024 字节？（提示：看 `0xB0 + i` 那三行命令）
12. `13cf2f3` 把 `OLED_ShowString` 改名成 `bsp_iic_oled_show_string`，为什么**必须**改？（三个理由）
13. IIC 版有软件 GRAM、SPI 版没有——各自的优劣是什么？什么场景该用哪种？

## 十一、练习题

1. **脏区域刷新**：给 IIC 版实现"只刷改动过的页"，把 `oled_show_rtc()` 的刷新耗时从 38 ms 降下来（提示：记录每页是否被写过的标志位）。
2. **算并验证**：用逻辑分析仪测一次 `bsp_iic_oled_refresh()` 的实际耗时，和第七章的估算（38 ms）对比，解释差在哪。
3. **统一接口**：给 IIC 版和 SPI 版抽一层公共接口（如 `oled_show_string_common()`），用函数指针或宏在两者间切换（参考第 15/16 篇的开关宏套路）。
4. **缩小 GRAM**：把 `OLED_GRAM[144][8]` 改成 `[128][8]`，验证显示是否正常、省下多少 RAM。
5. **画个界面**：用 `draw_point` / `draw_line` / `draw_circle` 组合出一个"表盘"界面，在上面显示 PCF8563 的时分秒（秒针每秒转一格）。
6. **字库对比实验**：同一句汉字，分别用 IIC 版（下标）和 SPI 版（GB2312）显示，对比两种方式的代码量与 Flash 占用。
7. **接上看门狗**：在 `oled_show_rtc()` 版的主循环里启用 WWDGT，观察是否复位；再改成"只刷改动区域"后重试（体会带宽与实时性的关系）。
8. **SPI 提速**：把 `SPI_PSC_4` 改成 `SPI_PSC_2`（42 MHz，**注意可能超出屏幕手册上限**），测刷屏时间变化，并查手册确认屏幕允许的最高 SCK。

---

## 附：提交清单

| 提交 | 日期 | 说明 | 关键改动 |
| --- | --- | --- | --- |
| `e941ecb` | 09-28 22:20 | [更新] 初步移植 IIC OLED 屏幕官方例程 | 新建 `Driver/bsp_iic_oled/`（+1236 行）：`bsp_iic_oled.c/h` 驱动 + **`oledfont.h` 字库（426 行）** + **`bmp.h` 图片（142 行）**；`main.c` 接入并写 `oled_test()` 演示 |
| `886ba18` | 09-29 12:00 | [更新] IIC OLED 显示 pcf8563 时间 | 新增 `oled_show_rtc()`（整幅背景 + 覆盖文字）；`msp_iic` 加 `write_col_nbyte()`（跨步取数刷屏）；`bsp_iic_oled` 71 行调整 |
| `13cf2f3` | 10-06 15:21 | [更新] SPI OLED | **新建 `Driver/bsp_spi_oled/`**（+413/+52）：8 线接口 + 字库芯片读取 + GB2312 地址公式；**同时把 IIC 版全部 `OLED_*` 重命名为 `bsp_iic_oled_*`**（166 行） |
| `5ce9c77` | 10-06 17:44 | [更新] SPI OLED 软实现 封装 | OLED 侧加 `OLED_WRITE_BYTE` 等适配宏接到软件 SPI（第 16 篇）；顺带整理 IIC 命名分层 |
| `b32b17a` | 10-06 18:11 | [更新] SPI OLED 硬实现 封装 | 换用硬件 SPI（AF5 + SPI0）；**OLED 代码零改动**（宏没变） |
| `1da26c5` | 10-15 22:08 | [修复] **main 编码必须为 gb2312**（`bsp_spi_oled_display_GB2312_string`） | `User/main.c` **78 行全是中文注释**：把 UTF-8 覆盖造成的乱码恢复成 GB2312；**因为 GB2312 字库直接吃字符串字节，编码错就显示错**（见 §6.2） |
| `5334620` | 10-06 19:56 | [更新] SPI OLED 软硬实现合并（当时是 `main` HEAD） | SPI 软硬通过 `SPI_HARD_SOFT_SWITCH` 合并；OLED 侧同样零改动 |
| `18cec36` | 10-07 17:55 | [更新] flash gd25q32 封装 | SPI 抽象层新增 `msp_spi_read_write_byte()`（第 16 篇 §4.5），**OLED 侧依旧零改动**——证明这套 `msp_spi_*` 抽象层的接口扩展是"只增不改"的 |

**这个模块的两条线**

| 线索 | 提交 | 学到的东西 |
| --- | --- | --- |
| **IIC 版** | `e941ecb` → `886ba18` | 官方例程移植、GRAM 缓冲、页地址模式、字库数组、整幅背景+覆盖文字 |
| **SPI 版** | `13cf2f3` → `5ce9c77` → `b32b17a` → `5334620` | 8 线接口、字库芯片、GB2312 地址公式、命名统一、接入 SPI 抽象层 |

## 参考笔记

- `../../../NOTE/Note/IIC.md` 第七章「实战一：软件 I2C 驱动 OLED」= 本篇 IIC 版的教材讲法
- `../../../NOTE/Note/SPI.md` 第九章「实战四：移植 SPI 屏幕（OLED）」= 本篇 SPI 版的教材讲法
- `../../../NOTE/Note/GPIO.md` 第三章 3.6 节「三种输出模式」——理解推挽/开漏对显示类外设的意义
- `../../../NOTE/Textbook/IIC/I2C屏幕案例.mhtml` —— IIC OLED 教材原文
- `../../../NOTE/Textbook/SPI/SPI屏幕案例.mhtml` —— SPI OLED 教材原文
- `../GD32F407_myLibrary/Doc/硬件信息汇总.md` 第 4.8 / 4.9 节 —— 板上 LCD、触摸屏与两块 OLED 的硬件情况

> 本笔记仅作学习整理，内容来自本仓库真实提交记录与源码。
