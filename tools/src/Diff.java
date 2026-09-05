import java.awt.image.BufferedImage; import java.io.File; import java.util.*; import javax.imageio.ImageIO;
public class Diff {
  public static void main(String[] a) throws Exception {
    for (String dir : a) {
      File[] fs = new File(dir).listFiles((d,n)->n.endsWith(".png"));
      Arrays.sort(fs, Comparator.comparing(File::getName));
      BufferedImage prev=null; double sum=0; int n=0, still=0; double max=0;
      BufferedImage first=ImageIO.read(fs[0]);
      double vsFirstMax=0;
      for (File f: fs) {
        BufferedImage img=ImageIO.read(f);
        if (prev!=null) { double d=pct(prev,img); sum+=d; n++; if(d<0.5) still++; if(d>max) max=d; }
        double vf=pct(first,img); if(vf>vsFirstMax) vsFirstMax=vf;
        prev=img;
      }
      System.out.printf("%-28s 相邻帧平均差异 %5.2f%%  最大 %5.2f%%  几乎静止(<0.5%%)的帧 %3d/%3d   与首帧最大差异 %5.2f%%%n",
        new File(dir).getName(), sum/n, max, still, n, vsFirstMax);
    }
  }
  static double pct(BufferedImage x, BufferedImage y){
    int w=x.getWidth(), h=x.getHeight(); long diff=0;
    for(int j=0;j<h;j+=2) for(int i=0;i<w;i+=2) if((x.getRGB(i,j)&0xFFFFFF)!=(y.getRGB(i,j)&0xFFFFFF)) diff++;
    return 100.0*diff/((w/2)*(h/2));
  }
}
