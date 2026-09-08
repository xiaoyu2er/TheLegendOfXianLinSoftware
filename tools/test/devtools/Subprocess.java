package devtools;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 在**新的 JVM 里**跑一个 main，收退出码与 stderr。
 *
 * 为什么必须是子进程：{@link ExportTrace#die} 走的是 {@code System.exit(2)}，
 * 在本进程里调它会把测试进程一起带走。而「硬失败」的契约恰恰就是那个退出码
 * 加那句 stderr —— 换成抛异常来测，测的就不是同一件事了。
 *
 * 顺带一条：{@code die} 有四个文件在调（BattleDriver / SceneDriver / ShopDriver
 * 里都有），其中一些在导出器自己起的线程上。把它改成抛异常，那些调用点就从
 * 「终止进程」变成「悄悄结束一条线程」—— 那是行为改动，不是可测性改造。
 * 所以这里绕开它，不改它。
 *
 * java 可执行文件与 classpath 都从当前 JVM 现取，不写死路径。
 */
final class Subprocess {

    private Subprocess() {}

    /**
     * 超时上限。挂住的子进程和跑得慢的子进程在「还没返回」这一点上长得一样，
     * 而没有上限的等待会让整套测试**永远不结束** —— 那是最糟的一种结果：
     * CI 上它既不绿也不红，只是一直转。实测本仓库这些子进程（起 JVM +
     * 加载原版 class + 硬失败退出）在 1 秒上下，20 秒是它的 20 倍。
     */
    private static final long TIMEOUT_MS = 20_000;

    static final class Result {
        final int exit;
        final String err;
        final String out;
        Result(int exit, String err, String out) { this.exit = exit; this.err = err; this.out = out; }
        @Override public String toString() { return "exit=" + exit + " stderr=" + oneLine(err); }
        private static String oneLine(String s) {
            String t = s.trim().replace('\n', ' ');
            return t.length() > 160 ? t.substring(0, 160) + "…" : t;
        }
    }

    /** 跑 {@code java -cp <当前 classpath> <mainClass> <args…>}，等它结束。 */
    static Result run(String mainClass, String... args) {
        // 局部变量不叫 java：那会把 java.util.* 这样的包名整个遮住，
        // 报出来的是 "variable util location: variable java of type String"，
        // 和真正的「类找不到」长得完全不一样。
        String javaBin = System.getProperty("java.home") + File.separator + "bin" + File.separator + "java";
        List<String> cmd = new ArrayList<>(Arrays.asList(
                javaBin,
                "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8",
                "-Djava.awt.headless=true",
                "-cp", System.getProperty("java.class.path"),
                mainClass));
        cmd.addAll(Arrays.asList(args));

        File outFile = null;
        File errFile = null;
        try {
            // 两条流都重定向到文件，不在父进程里边读边等：管道写满时子进程会
            // 阻塞在写上、父进程阻塞在读另一条流上，两边互等 —— 那个死锁的样子
            // 就是「挂住了」，和子进程自己跑得慢分不开。
            outFile = File.createTempFile("xl-subproc-out", ".txt");
            errFile = File.createTempFile("xl-subproc-err", ".txt");
            Process p = new ProcessBuilder(cmd)
                    .redirectOutput(outFile)
                    .redirectError(errFile)
                    .start();
            boolean done = p.waitFor(TIMEOUT_MS, TimeUnit.MILLISECONDS);
            if (!done) {
                p.destroyForcibly();
                p.waitFor();
                throw new IllegalStateException("子进程 " + TIMEOUT_MS + "ms 没结束，已强杀: " + cmd
                        + "\n  stderr: " + read(errFile));
            }
            return new Result(p.exitValue(), read(errFile), read(outFile));
        } catch (IOException e) {
            throw new IllegalStateException("起不来子进程: " + cmd, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("等子进程时被打断: " + cmd, e);
        } finally {
            if (outFile != null) outFile.delete();
            if (errFile != null) errFile.delete();
        }
    }

    private static String read(File f) throws IOException {
        return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
    }
}
