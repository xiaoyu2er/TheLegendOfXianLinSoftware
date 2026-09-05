import java.awt.image.BufferedImage;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;
import javax.swing.JPanel;
import main.GameLauncher;
import scene.ScenePanel;

public class ShotFix {
  static String out; static List<String> errs=new ArrayList<>();
  static Map<String,int[]> tally=new LinkedHashMap<>();
  static void bump(String k,boolean ok){int[] v=tally.computeIfAbsent(k,x->new int[2]);v[1]++;if(ok)v[0]++;}
  static boolean shot(JPanel p,String sub,String name){
    try{File d=new File(out,sub);d.mkdirs();
      BufferedImage img=new BufferedImage(1024,640,BufferedImage.TYPE_INT_RGB);
      p.paint(img.getGraphics()); ImageIO.write(img,"png",new File(d,name+".png")); return true;
    }catch(Throwable t){errs.add(sub+"/"+name+" -> "+t);return false;}
  }
  static void nap(long ms){try{Thread.sleep(ms);}catch(Exception e){}}
  static boolean has(String s,String sec){
    try(BufferedReader br=new BufferedReader(new InputStreamReader(new FileInputStream("script/"+s),"GBK"))){
      String l; while((l=br.readLine())!=null) if(l.trim().equals(sec)) return true;
    }catch(Exception e){} return false;
  }
  public static void main(String[] a) throws Exception{
    out=a[0]; String mode=a[1]; new File(out).mkdirs();
    new GameLauncher(); nap(2500);
    ScenePanel sp=GameLauncher.scenePanel; sp.initiation("剧情1.txt"); nap(400);
    File[] fs=new File("script").listFiles((d,n)->n.endsWith(".txt"));
    Arrays.sort(fs,Comparator.comparing(File::getName));

    for(File f: fs){
      String s=f.getName(), base=s.replace(".txt","");
      if(mode.equals("nar")){
        if(!has(s,"Narratage")) continue;
        boolean any=false;
        try{ sp.initiation(s); nap(200);
          sp.narratage.checkNarratage();            // 内部 init() + isNarratage=true
          for(int i=0;i<6;i++){ nap(600); any|=shot(sp,"03-narratage",base+"_t"+i); }
        }catch(Throwable t){errs.add("nar "+s+" -> "+t);}
        bump("narratage",any);
      } else if(mode.equals("tb")){
        if(!has(s,"TreasureBox")) continue;
        boolean any=false;
        try{ sp.initiation(s); nap(200);
          ArrayList<String[]> tb=sp.getReader().getTreasureBox();
          for(int i=0;i<tb.size() && i<3;i++){
            String[] xy=tb.get(i)[0].split("/");          // 坐标是 "x/y" 一个字段
            int x=Integer.parseInt(xy[0].trim()), y=Integer.parseInt(xy[1].trim());
            sp.equipmentEvent.checBoxes(x,y); nap(250);
            any|=shot(sp,"06-treasure",base+"_b"+i+"_near");
            for(int k: new int[]{10,32,74,75,90}){ sp.equipmentEvent.keyPressed(k); nap(300); }
            any|=shot(sp,"06-treasure",base+"_b"+i+"_open");
          }
        }catch(Throwable t){errs.add("tb "+s+" -> "+t);}
        bump("treasureBox",any);
      } else if(mode.equals("battle")){
        if(!has(s,"Fight")) continue;
        boolean any=false;
        try{ sp.initiation(s); nap(300);
          if(sp.getReader().getBattle1()!=null) sp.fightEvent.startBattle1(); else sp.fightEvent.startBattle0(); nap(150);
          for(int i=0;i<30;i++){ any|=shot(GameLauncher.battlePanel,"08-battle/"+base,String.format("f%02d",i)); nap(100); }
        }catch(Throwable t){errs.add("battle "+s+" -> "+t);}
        bump("battle",any);
      }
    }
    System.out.println("======== "+mode+" ========");
    for(Map.Entry<String,int[]> e: tally.entrySet()) System.out.printf("%-14s %3d / %3d%n",e.getKey(),e.getValue()[0],e.getValue()[1]);
    System.out.println("错误 "+errs.size()+" 条");
    for(int i=0;i<Math.min(errs.size(),15);i++) System.out.println("  "+errs.get(i));
    System.exit(0);
  }
}
