; Test file for x86 assembly syntax highlighting
; Also exercises AT&T syntax, ARM/AArch64, RISC-V, and MIPS tokens.
section .data
    flag db 1
    count dw 64
    mask dd 0xFFFFFFFFh
    value dq 3.14159
    buffer resq 4
    message db "hello", 10, 0

section .text
global _start

_start:
    ; Test SSE2/AVX instructions that should be highlighted
    movq xmm0, [value]     ; movq and xmm0 should be highlighted 
    xorpd xmm1, xmm1       ; xorpd and xmm1 should be highlighted  
    cvttsd2si eax, xmm0    ; cvttsd2si should be highlighted
    cvtsi2sd xmm2, eax     ; cvtsi2sd and xmm2 should be highlighted
    subsd xmm0, xmm1       ; subsd should be highlighted
    mulsd xmm0, xmm2       ; mulsd should be highlighted
    divsd xmm0, xmm1       ; divsd should be highlighted
    
    ; Test other SIMD registers
    vmovdqa ymm0, ymm1     ; ymm registers should be highlighted
    vmovdqu ymm2, [value]  ; AVX instruction should be highlighted
    vmovapd ymm3, ymm2     ; AVX instruction should be highlighted
    vaddsd xmm0, xmm1, xmm2
    vxorpd xmm4, xmm4, xmm4
    vpaddd ymm5, ymm5, ymm6
    vzeroupper             ; AVX instruction should be highlighted
    
    ; Test AVX-512 registers
    vmovdqa32 zmm0, zmm1{k1}  ; zmm and k registers should be highlighted
    
    ; Test tile registers
    tileloadd tmm0, [rsi]  ; tmm0 should be highlighted
    
    ; Test NASM directives
    %define MY_CONSTANT 42
    %if MY_CONSTANT > 40
        mov eax, 1
    %endif

    
    ; Exit
    mov eax, 60
    mov edi, 0
    syscall 

; GNU as / AT&T style x86
.globl att_start
att_start:
    movq $60, %rax
    leaq message(%rip), %rdi
    xorpd %xmm0, %xmm0
    syscall

; AArch64 / ARM style
.arch armv8-a
.global arm_start
arm_start:
    adrp x0, message
    add x0, x0, :lo12:message
    mov w8, #64
    svc #0
    ret

thumb_example:
    push {r4, lr}      @ ARM comment style
    ldr r0, =message
    bl puts
    pop {r4, pc}

; RISC-V style
.option norelax
riscv_start:
    la a0, message
    li a7, 64
    addi sp, sp, -16
    sw ra, 12(sp)
    ecall
    ret

; MIPS style
.ent mips_start
mips_start:
    la $a0, message
    li $v0, 4004
    syscall
    jr $ra
.end mips_start
