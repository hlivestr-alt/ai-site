// Customer choices shared with the UI. Paths and render expressions stay private.
export const variationGrades = ["original", "warm", "cool", "vivid", "desaturated", "cinematic"] as const;
export const variationFonts = {sans: "Clean sans", display: "Bold display", serif: "Classic serif"} as const;
export const variationStyles = {current: "Current", creator_bold_pop: "Creator Bold Pop", native_clean: "Native Clean", premium_skincare: "Premium Skincare", sales_karaoke: "Sales Karaoke", urgency_stack: "Urgency Stack"} as const;
export type VariationSettings = {
  name:string; textStyle:keyof typeof variationStyles; hookType:"none"|"text";
  subtitleEnabled:boolean; subtitlePosition:"top"|"center"|"bottom"; subtitleY:number;
  subtitleSize:"compact"|"small"|"medium"|"large"; subtitleFont:keyof typeof variationFonts;
  fontColor:string; highlightColor:string; highlightEnabled:boolean; phraseCaptions:boolean;
  colorGrade:typeof variationGrades[number]; mirror:boolean;
  letterboxEnabled:boolean; topBar:number; bottomBar:number;
  topHookEnabled:boolean; hookFont:keyof typeof variationFonts; hookColor:string;
  hookSize:number; hookX:number; hookY:number;
};
export const defaultVariationSettings:VariationSettings={name:"",textStyle:"current",hookType:"text",subtitleEnabled:true,subtitlePosition:"bottom",subtitleY:0.84,subtitleSize:"small",subtitleFont:"sans",fontColor:"#FFFFFF",highlightColor:"#FFD600",highlightEnabled:true,phraseCaptions:false,colorGrade:"original",mirror:false,letterboxEnabled:false,topBar:0.2,bottomBar:0.2,topHookEnabled:false,hookFont:"sans",hookColor:"#FFFFFF",hookSize:72,hookX:0.5,hookY:0.5};
export function applyVariationStyle(settings:VariationSettings,textStyle:VariationSettings["textStyle"]):VariationSettings{
  const presets:Record<string,Partial<VariationSettings>>={
    creator_bold_pop:{subtitleFont:"display",subtitleSize:"compact",highlightColor:"#FF2D78",highlightEnabled:false,phraseCaptions:true,subtitleY:0.67},
    native_clean:{subtitleFont:"sans",subtitleSize:"small",fontColor:"#FFFFFF",highlightEnabled:false,phraseCaptions:true,subtitleY:0.76},
    premium_skincare:{subtitleFont:"serif",subtitleSize:"compact",fontColor:"#FFF5D7",highlightColor:"#E4BA7B",highlightEnabled:false,phraseCaptions:true,subtitleY:0.75},
    sales_karaoke:{subtitleFont:"display",subtitleSize:"small",fontColor:"#FFFFFF",highlightColor:"#FFD600",highlightEnabled:true,phraseCaptions:false,subtitleY:0.72},
    urgency_stack:{subtitleFont:"display",subtitleSize:"small",fontColor:"#FFFFFF",highlightColor:"#FF3B30",highlightEnabled:true,phraseCaptions:false,subtitleY:0.72},
  };
  return {...settings,...presets[textStyle],textStyle};
}
