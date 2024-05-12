# 第四章 串
## string
### 定义
- <font color=#75C940>零个</font> 或 <font color=#75C940>多个</font> 字符构成的 <font color=#75C940>有限</font> 序列
- 串长：串中字符个数
- 空串：串长为0
- 子串：串中任意多个 <font color=#75C940>连续</font> 的字符构成的子序列
- 位置：字符在串中的序号；子串的第一个字符在主串中的位置
### <font color=#DC2D1E>基本操作</font>
### 存储结构
#### <font color=#40A8F5>定长顺序存储</font>
- 定义
```c:line-numbers

```
- 基本操作
    - 求子串
    ```c:line-numbers

    ```
    - 串的比较 
    ```c:line-numbers

    ```
    - S中定位字串T <font color=#40A8F5>朴素模式匹配</font>
    ```c:line-numbers

    ```
- 特点
#### <font color=#40A8F5>堆分配存储</font>
- 定义
```c:line-numbers

```
- 基本操作
- 特点
#### <font color=#40A8F5>块链存储</font>
- 定义
```c:line-numbers

```
- 基本操作
- 特点
### 匹配算法思路
#### 暴力（朴素）匹配思路
- 枚举串中所有长度等于模式串的子串，依次对比二者对应位置的字符。
- 失配时i到下一个子串开头位置，j到模式串的开头位置
#### KMP算法思路
- 对于暴力匹配，在匹配过程中遇到某一位置失配时，该位置前的字符全部匹配成功，说明串中对应位置的字符和模式串完全相同，要利用这一信息进行算法优化。
- 在串中的字符的后半部分将与模式串的前半部分匹配，思考这两者相同时随后后才有可能匹配，即找到后缀和前缀相同的位置进行匹配，避免在该位置之前无意义的匹配比较。
### <font color=#DC2D1E>模式匹配算法</font>
#### 暴力匹配法
```c:line-numbers

```
#### <font color=#DC2D1E>KMP算法</font>
```c:line-numbers

```
- <font color=#DC2D1E>next数组</font>
#### <font color=#DC2D1E>KMP算法进一步改进</font>
```c:line-numbers

```
- <font color=#DC2D1E>nextval数组</font>