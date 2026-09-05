import java.awt.image.BufferedImage; import java.io.File; import java.util.*; import javax.imageio.ImageIO;
public class Audit {
  public static void main(String[] a) throws Exception {
    File root=new File(a[0]);
    File[] ds=root.listFiles(File::isDirectory); Arrays.sort(ds,Comparator.comparing(File::getName));
    System.out.printf("%-10s %5s %8s %10s %10s %s%n","战斗","帧数","静止起点","静止后平均","静止后最大","判定");
    for(File d: ds){
      File[] fs=d.listFiles((x,n)->n.endsWith(".png")); Arrays.sort(fs,Comparator.comparing(File::getName));
      // 找"静止起点"：第一个 i 使得 i..end 中每帧与 f[i] 差异都 < 12%
      BufferedImage[] im=new BufferedImage[fs.length];
      for(int i=0;i<fs.length;i++) im[i]=ImageIO.read(fs[i]);
      int settle=-1;
      for(int i=0;i<fs.length;i++){
        double mx=0; for(int j=i;j<fs.length;j+=3){ double p=pct(im[i],im[j]); if(p>mx) mx=p; }
        if(mx<12){ settle=i; break; }
      }
      double avg=0,mx=0; int n=0;
      if(settle>=0){ for(int j=settle;j<fs.length;j++){ double p=pct(im[settle],im[j]); avg+=p; n++; if(p>mx)mx=p; } avg/=n; }
      String verdict = settle<0 ? "✅ 全程有动作"
        : settle<fs.length/3 ? "❌ 早早卡死 ("+(fs.length-settle)*100/fs.length+"% 的帧是静止的)"
        : "⚠️ 后段卡住 ("+(fs.length-settle)*100/fs.length+"%)";
      System.out.printf("%-10s %5d %8s %9.2f%% %9.2f%%  %s%n", d.getName(), fs.length,
        settle<0?"—":("f"+settle), avg, mx, verdict);
    }
  }
  static double pct(BufferedImage x,BufferedImage y){int w=x.getWidth(),h=x.getHeight();long d=0;
    for(int j=0;j<h;j+=4)for(int i=0;i<w;i+=4) if((x.getRGB(i,j)&0xFFFFFF)!=(y.getRGB(i,j)&0xFFFFFF)) d++;
    return 100.0*d/((w/4)*(h/4));}
}
